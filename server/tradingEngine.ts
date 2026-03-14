import { storage } from "./storage";
import {
  getBtcPrice, getKxbtcdMarkets, getBalance, getOpenPositions,
  getSettledPositions, placeOrder, cancelOrder, KalshiMarket
} from "./kalshi";
import type { EventEmitter } from "events";

// ── THETA DECAY STRATEGY (KXBTCD) ───────────────────────────────────────────
//
// Core edge: BTC is priced at ~$71,000. An hourly market resolves YES if BTC
// ends above $72,000. With 30 min left, YES might be at 15¢ — it's unlikely
// but not zero. We buy NO at 85¢ and collect as time decays.
//
// Entry rules (NO-only — YES entries are disabled):
//  1. Find a strike ≥ MIN_CUSHION_PCT ABOVE current BTC price
//  2. NO price must be ≥ MIN_NO_PRICE (we want to be paid well for the risk)
//  3. ≥ MIN_TIME_REMAINING_MS left on the market
//  4. BTC must NOT be trending hard toward the strike (momentum check)
//
// Exit rules:
//  1. NO price hits PROFIT_TARGET_PCT of entry → sell (lock in decay)
//  2. NO price drops to STOP_LOSS_PCT of entry → cut loss
//  3. Market closes → settle naturally (let it expire, preferred outcome)
//  4. BTC within DANGER_ZONE_PCT of strike → emergency exit

export interface EngineState {
  running: boolean;
  lastRun: Date | null;
  btcPrice: number;
  balance: number;
  openPositions: any[];
  currentMarket: KalshiMarket | null;
  availableMarkets: KalshiMarket[];
  error: string | null;
  priceHistory: Array<{ time: number; price: number }>;
  activeDecayTrade: DecayTrade | null;
  lastExitReason: string | null;
  decaySignal: DecaySignal | null;
  netLiqValue: number;
}

interface DecayTrade {
  tradeId: number;
  orderId: string;
  ticker: string;
  side: "no";                              // NO-only strategy
  tradeSide: "above_no";
  count: number;
  entryPriceInCents: number;
  stopPriceInCents: number;
  targetPriceInCents: number;
  strikePrice: number;
  btcPriceAtEntry: number;
  openedAt: number;
  marketCloseTime: string;
}

interface DecaySignal {
  shouldEnter: boolean;
  side: "no";                              // always no
  marketTicker: string;
  strikePrice: number;
  distancePct: number;
  noPriceInCents: number;
  timeToCloseMs: number;
  reasoning: string;
  confidence: number;
  btcMomentum: number;
}

// ── STRATEGY PARAMETERS ───────────────────────────────────────────────
// BTC must be at least 1% below the strike before we'll buy NO
const MIN_CUSHION_PCT = 1.0;
// We want NO priced at least 75¢ — means YES has <25% chance → comfortable
const MIN_NO_PRICE_CENTS = 75;
// Won't enter if less than 8 minutes left
const MIN_TIME_REMAINING_MS = 8 * 60 * 1000;
// Exit if BTC gets within 0.3% of strike (danger zone, tighter than before)
const DANGER_ZONE_PCT = 0.3;
// Profit target: sell NO when it appreciates to this % of entry
const PROFIT_TARGET_MULT = 0.92;
// Stop loss: cut if NO drops to this fraction of entry price
const STOP_LOSS_MULT = 0.80;
// Momentum lookback: how many recent ticks to measure BTC trend
const MOMENTUM_TICKS = 12;
// Max BTC momentum toward strike before skipping entry
const MAX_ENTRY_MOMENTUM_PCT = 0.05;  // tightened from 0.08

const state: EngineState = {
  running: false,
  lastRun: null,
  btcPrice: 0,
  balance: 0,
  openPositions: [],
  currentMarket: null,
  availableMarkets: [],
  error: null,
  priceHistory: [],
  activeDecayTrade: null,
  lastExitReason: null,
  decaySignal: null,
  netLiqValue: 0,
};

const marketCooldowns = new Map<string, number>();
const MARKET_COOLDOWN_MS = 5 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let emitter: EventEmitter | null = null;
let priceHistory: number[] = [];

export function setEmitter(e: EventEmitter) { emitter = e; }

function broadcast(event: string, data: any) {
  if (emitter) emitter.emit("sse", { event, data });
}

export function getState(): EngineState { return { ...state }; }

// ── BTC MOMENTUM ─────────────────────────────────────────────────────────────
function calcBtcMomentum(prices: number[], ticks: number): number {
  if (prices.length < ticks + 1) return 0;
  const from = prices[prices.length - 1 - ticks];
  const to   = prices[prices.length - 1];
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

// ── NET LIQUIDATION VALUE ───────────────────────────────────────────────────
function calcNetLiq(balance: number, openPositions: any[], activeDecayTrade: DecayTrade | null, currentMarket: KalshiMarket | null): number {
  let openValue = 0;
  if (activeDecayTrade && currentMarket && currentMarket.ticker === activeDecayTrade.ticker) {
    const currentBid = currentMarket.no_bid;
    if (currentBid > 0) {
      openValue = (currentBid / 100) * activeDecayTrade.count;
    }
  }
  return balance + openValue;
}

// ── DECAY SIGNAL (NO-ONLY) ───────────────────────────────────────────────────
function generateDecaySignal(
  markets: KalshiMarket[],
  btcPrice: number,
  btcPrices: number[],
  settings: any
): DecaySignal | null {
  const momentum = calcBtcMomentum(btcPrices, MOMENTUM_TICKS);
  const minCushion = settings.minCushionPct ?? MIN_CUSHION_PCT;
  const minNoPrice = settings.minNoPrice ?? MIN_NO_PRICE_CENTS;

  // NO-only: find a strike ABOVE current BTC price by at least minCushion%.
  // BTC must NOT be surging upward toward it.
  const noCandidate = markets.find(m => {
    if (m.side !== "above") return false;      // YES resolves if BTC ends above strike
    if (m.distancePct < minCushion) return false;  // strike not far enough above BTC
    if (m.distancePct > 5.0) return false;     // too far, NO priced at 99¢, no edge
    if (m.no_bid < minNoPrice) return false;   // not being paid enough
    const closeMs = new Date(m.close_time).getTime() - Date.now();
    if (closeMs < MIN_TIME_REMAINING_MS) return false;
    const cooldownExpiry = marketCooldowns.get(m.ticker);
    if (cooldownExpiry && Date.now() < cooldownExpiry) return false;
    if (momentum > MAX_ENTRY_MOMENTUM_PCT && m.distancePct < 1.5) return false;
    return true;
  });

  if (!noCandidate) return null;

  const timeToCloseMs = new Date(noCandidate.close_time).getTime() - Date.now();
  const confidence = calcConfidence(noCandidate.distancePct, noCandidate.no_bid, timeToCloseMs, momentum);

  return {
    shouldEnter: confidence >= (settings.minConfidence ?? 75),
    side: "no",
    marketTicker: noCandidate.ticker,
    strikePrice: noCandidate.strikePrice,
    distancePct: noCandidate.distancePct,
    noPriceInCents: noCandidate.no_bid,
    timeToCloseMs,
    btcMomentum: momentum,
    confidence,
    reasoning: buildReasoning(noCandidate, momentum, timeToCloseMs, confidence),
  };
}

function calcConfidence(
  distancePct: number,
  noPriceInCents: number,
  timeToCloseMs: number,
  momentum: number
): number {
  let conf = 50;

  // More cushion = higher confidence
  if (distancePct >= 3.0) conf += 25;
  else if (distancePct >= 2.0) conf += 20;
  else if (distancePct >= 1.5) conf += 15;
  else if (distancePct >= 1.0) conf += 8;

  // Better NO price = market strongly favors us
  if (noPriceInCents >= 90) conf += 15;
  else if (noPriceInCents >= 85) conf += 10;
  else if (noPriceInCents >= 75) conf += 5;

  // More time = more cushion for decay to work
  const minsLeft = timeToCloseMs / 60000;
  if (minsLeft >= 30) conf += 10;
  else if (minsLeft >= 15) conf += 5;

  // Momentum penalty: BTC charging upward toward strike
  if (momentum > 0.03) conf -= Math.min(25, momentum * 120);

  return Math.min(95, Math.max(0, conf));
}

function buildReasoning(
  market: KalshiMarket,
  momentum: number,
  timeToCloseMs: number,
  confidence: number
): string {
  const minsLeft = Math.round(timeToCloseMs / 60000);
  return [
    `BTC $${Math.round(market.strikePrice - (market.distancePct / 100 * market.strikePrice)).toLocaleString()} vs strike $${market.strikePrice.toLocaleString()} (+${market.distancePct.toFixed(2)}% cushion)`,
    `NO @ ${market.no_bid}¢ — betting BTC stays below strike`,
    `${minsLeft}m left | momentum ${momentum > 0 ? "+" : ""}${(momentum * 100).toFixed(1)}bp`,
    `confidence ${confidence.toFixed(0)}%`,
  ].join(" | ");
}

// ── MAIN CYCLE ───────────────────────────────────────────────────────────
async function runCycle() {
  const settings = await storage.getBotSettings();
  const creds    = await storage.getCredentials();

  // 1. BTC price
  try {
    const price = await getBtcPrice();
    if (price > 0) {
      state.btcPrice = price;
      priceHistory.push(price);
      if (priceHistory.length > 300) priceHistory.shift();
      state.priceHistory.push({ time: Date.now(), price });
      if (state.priceHistory.length > 120) state.priceHistory.shift();
    }
  } catch (e: any) { state.error = "BTC price fetch failed: " + e.message; }

  // 2. KXBTCD Markets
  try {
    const markets = await getKxbtcdMarkets(creds?.environment ?? "production", state.btcPrice);
    state.availableMarkets = markets;
    state.currentMarket = markets.find(m => {
      const dist = m.distancePct;
      return dist >= (settings.minCushionPct ?? MIN_CUSHION_PCT) && dist <= 5.0;
    }) ?? markets[0] ?? null;
  } catch (e: any) { state.error = "Market fetch failed: " + e.message; }

  // 3. Balance + positions
  if (creds) {
    try {
      state.balance = await getBalance(creds.apiKeyId, creds.privateKeyPem, creds.environment);
      state.openPositions = await getOpenPositions(creds.apiKeyId, creds.privateKeyPem, creds.environment);
      state.error = null;
    } catch (e: any) { state.error = "Auth failed: " + e.message; }
  }

  // 4. Net liq
  state.netLiqValue = calcNetLiq(state.balance, state.openPositions, state.activeDecayTrade, state.currentMarket);

  // 5. Decay signal (NO-only)
  if (state.btcPrice > 0 && state.availableMarkets.length > 0) {
    state.decaySignal = generateDecaySignal(state.availableMarkets, state.btcPrice, priceHistory, settings);
  }

  state.lastRun = new Date();

  // 6. Trading logic
  if (settings.enabled && creds) {
    if (state.activeDecayTrade) {
      const tradeMarket = state.availableMarkets.find(m => m.ticker === state.activeDecayTrade!.ticker)
        ?? state.currentMarket;
      if (tradeMarket) {
        await checkDecayExit(settings, creds, state.activeDecayTrade, tradeMarket);
      } else {
        await settleClosedTrade(creds, state.activeDecayTrade);
      }
    } else if (state.decaySignal?.shouldEnter) {
      await tryDecayEntry(settings, creds, state.decaySignal);
    }
  }

  broadcast("state", buildStatePayload());
}

// ── DECAY EXIT ─────────────────────────────────────────────────────────────
async function checkDecayExit(settings: any, creds: any, trade: DecayTrade, market: KalshiMarket) {
  const msToClose = new Date(market.close_time).getTime() - Date.now();

  if (trade.ticker !== market.ticker || msToClose <= 0) {
    await settleClosedTrade(creds, trade);
    return;
  }

  const currentBid = market.no_bid;
  if (currentBid <= 0) return;

  const pnlPct = ((currentBid - trade.entryPriceInCents) / trade.entryPriceInCents) * 100;

  // Danger zone: BTC getting too close to the strike
  const btcToStrikePct = ((trade.strikePrice - state.btcPrice) / state.btcPrice) * 100;
  const inDangerZone = btcToStrikePct < DANGER_ZONE_PCT && btcToStrikePct >= 0;
  const struckThrough = btcToStrikePct < 0; // BTC crossed the strike

  const hitProfit  = currentBid >= trade.targetPriceInCents;
  const hitStop    = currentBid <= trade.stopPriceInCents;
  const nearClose  = msToClose < 3 * 60 * 1000; // 3 min — let expire naturally

  if (!hitProfit && !hitStop && !inDangerZone && !struckThrough && !nearClose) return;

  let reason: string;
  if (struckThrough) {
    reason = `BTC crossed strike $${trade.strikePrice.toLocaleString()} — emergency exit (P&L: ${pnlPct.toFixed(1)}%)`;
  } else if (inDangerZone) {
    reason = `Danger zone: BTC within ${DANGER_ZONE_PCT}% of strike — cutting (P&L: ${pnlPct.toFixed(1)}%)`;
  } else if (hitProfit) {
    reason = `Profit target hit: NO appreciated to ${currentBid}¢ (+${pnlPct.toFixed(1)}%)`;
  } else if (hitStop) {
    reason = `Stop-loss hit: NO dropped to ${currentBid}¢ (${pnlPct.toFixed(1)}%)`;
  } else {
    return; // nearClose + comfortable — let it expire
  }

  console.log(`[Decay] EXIT — ${reason}`);

  try {
    const exitAsk = market.no_ask;
    const exitPrice = Math.max(1, Math.min(99, exitAsk > 0 ? exitAsk : currentBid));

    await placeOrder(
      creds.apiKeyId, creds.privateKeyPem,
      trade.ticker, "no", "sell", trade.count, exitPrice, creds.environment
    );

    const pnlDollars = ((currentBid - trade.entryPriceInCents) / 100) * trade.count;
    const tradeStatus = pnlDollars >= 0 ? "won" : "lost";

    if (tradeStatus === "lost") {
      marketCooldowns.set(trade.ticker, Date.now() + MARKET_COOLDOWN_MS);
      console.log(`[Cooldown] Loss on ${trade.ticker} — 5m cooldown`);
    }

    await storage.updateTrade(trade.tradeId, {
      status: tradeStatus,
      pnl: pnlDollars,
      resolvedAt: new Date(),
      signalReason: `EXIT: ${reason}`,
    });

    state.activeDecayTrade = null;
    state.lastExitReason = reason;
    broadcast("trade", { message: `Decay exit: NO @ ${exitPrice}¢ | ${reason}`, pnl: pnlDollars });
  } catch (e: any) {
    state.error = "Sell failed: " + e.message;
  }
}

async function settleClosedTrade(creds: any, trade: DecayTrade) {
  let resolvedPnl: number | null = null;
  let resolvedStatus = "settled";

  if (creds) {
    try {
      const settled = await getSettledPositions(creds.apiKeyId, creds.privateKeyPem, creds.environment);
      const pos = settled.find((p: any) => p.ticker === trade.ticker);
      if (pos) {
        const realized = pos.realized_pnl ?? pos.pnl ?? null;
        if (realized !== null) {
          resolvedPnl = realized / 100;
          resolvedStatus = resolvedPnl >= 0 ? "won" : "lost";
        }
      }
    } catch {}
  }

  if (resolvedStatus === "lost") {
    marketCooldowns.set(trade.ticker, Date.now() + MARKET_COOLDOWN_MS);
  }

  await storage.updateTrade(trade.tradeId, {
    status: resolvedStatus,
    pnl: resolvedPnl,
    signalReason: `SETTLED: market closed${resolvedPnl !== null ? ` | P&L: $${resolvedPnl.toFixed(2)}` : ""}`,
    resolvedAt: new Date(),
  });

  state.activeDecayTrade = null;
  state.lastExitReason = `Market settled${resolvedPnl !== null ? ` (${resolvedPnl >= 0 ? "+" : ""}$${resolvedPnl.toFixed(2)})` : ""}`;
  broadcast("info", { message: `Trade settled: ${trade.ticker}${resolvedPnl !== null ? ` | P&L: ${resolvedPnl >= 0 ? "+" : ""}$${resolvedPnl.toFixed(2)}` : ""}` });
}

// ── DECAY ENTRY ─────────────────────────────────────────────────────────────
async function tryDecayEntry(settings: any, creds: any, signal: DecaySignal) {
  if (state.balance >= settings.targetBalance) {
    console.log(`[Bot] Balance ${state.balance} ≥ target ${settings.targetBalance}, pausing`);
    await storage.updateBotSettings({ enabled: false });
    broadcast("info", { message: `🎯 Target balance $${settings.targetBalance} reached! Bot paused.` });
    return;
  }

  const tradeAmount = state.balance * (settings.riskPercent / 100);
  if (tradeAmount < 0.01) return;

  const market = state.availableMarkets.find(m => m.ticker === signal.marketTicker);
  if (!market) { console.log("[Decay] Signal market not found in available list"); return; }

  const priceInCents = Math.max(1, Math.min(99, market.no_ask > 0 ? market.no_ask : market.no_bid));

  const targetPriceInCents = Math.min(99, Math.round(priceInCents * (1 / PROFIT_TARGET_MULT)));
  const stopPriceInCents   = Math.max(1, Math.round(priceInCents * STOP_LOSS_MULT));

  const pricePerContract = priceInCents / 100;
  const count = Math.max(1, Math.floor(tradeAmount / pricePerContract));
  const actualCost = count * pricePerContract;

  console.log(`[Decay] Entering NO ${count}x ${signal.marketTicker} @ ${priceInCents}¢ | strike $${signal.strikePrice.toLocaleString()} | dist ${signal.distancePct.toFixed(2)}%`);

  try {
    const order = await placeOrder(
      creds.apiKeyId, creds.privateKeyPem,
      signal.marketTicker, "no", "buy", count, priceInCents, creds.environment
    );

    const trade = await storage.createTrade({
      orderId: order.order_id,
      ticker: signal.marketTicker,
      side: "no",
      action: "buy",
      count,
      pricePerContract: priceInCents,
      totalCost: actualCost,
      status: "filled",
      signalReason: signal.reasoning,
      btcPriceAtTrade: state.btcPrice,
      marketTitle: market.title,
      settingsVersion: settings.settingsVersion,
    });

    state.activeDecayTrade = {
      tradeId: trade.id,
      orderId: order.order_id,
      ticker: signal.marketTicker,
      side: "no",
      tradeSide: "above_no",
      count,
      entryPriceInCents: priceInCents,
      stopPriceInCents,
      targetPriceInCents,
      strikePrice: signal.strikePrice,
      btcPriceAtEntry: state.btcPrice,
      openedAt: Date.now(),
      marketCloseTime: market.close_time,
    };

    broadcast("trade", {
      message: `Decay entry: NO ${count}x @ ${priceInCents}¢ | strike $${signal.strikePrice.toLocaleString()} | dist ${signal.distancePct.toFixed(2)}% | ${signal.reasoning}`,
      trade,
    });
  } catch (e: any) {
    state.error = "Order failed: " + e.message;
    broadcast("error", { message: e.message });
  }
}

function buildStatePayload() {
  return {
    btcPrice: state.btcPrice,
    balance: state.balance,
    netLiqValue: state.netLiqValue,
    openPositions: state.openPositions,
    currentMarket: state.currentMarket,
    availableMarkets: state.availableMarkets,
    error: state.error,
    lastRun: state.lastRun,
    priceHistory: state.priceHistory,
    activeDecayTrade: state.activeDecayTrade,
    lastExitReason: state.lastExitReason,
    decaySignal: state.decaySignal,
  };
}

export async function startEngine() {
  if (intervalHandle) return;
  state.running = true;
  state.activeDecayTrade = null;
  marketCooldowns.clear();
  await runCycle();
  const settings = await storage.getBotSettings();
  const pollMs = (settings.pollInterval ?? 30) * 1000;
  intervalHandle = setInterval(runCycle, pollMs);
  console.log(`[Engine] KXBTCD NO-Only Decay Bot started — polling every ${settings.pollInterval ?? 30}s`);
}

export function stopEngine() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  state.running = false;
  state.activeDecayTrade = null;
  console.log("[Engine] Stopped");
}

export async function restartEngine() {
  stopEngine();
  await startEngine();
}
