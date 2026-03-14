import type { Express } from "express";
import { Server } from "http";
import { EventEmitter } from "events";
import { storage } from "./storage";
import { getBalance, getKxbtcdMarkets, getBtcPrice } from "./kalshi";
import { startEngine, stopEngine, restartEngine, getState, setEmitter } from "./tradingEngine";

const sseEmitter = new EventEmitter();
sseEmitter.setMaxListeners(100);
setEmitter(sseEmitter);

export async function registerRoutes(httpServer: Server, app: Express) {
  startEngine();

  // ── SSE Live Updates ─────────────────────────────────────────────────────
  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = ({ event, data }: { event: string; data: any }) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sseEmitter.on("sse", send);

    const state = getState();
    send({ event: "state", data: {
      btcPrice: state.btcPrice,
      balance: state.balance,
      netLiqValue: state.netLiqValue,
      openPositions: state.openPositions,
      decaySignal: state.decaySignal,
      currentMarket: state.currentMarket,
      availableMarkets: state.availableMarkets,
      error: state.error,
      lastRun: state.lastRun,
      priceHistory: state.priceHistory,
      activeDecayTrade: state.activeDecayTrade,
      lastExitReason: state.lastExitReason,
    }});

    req.on("close", () => { sseEmitter.off("sse", send); });
  });

  // ── State snapshot (for initial page load) ────────────────────────────────
  app.get("/api/state", async (req, res) => {
    const state = getState();
    const settings = await storage.getBotSettings();
    const trades = await storage.getTrades(5);
    res.json({
      ...state,
      settings,
      recentTrades: trades,
    });
  });

  // ── Credentials ──────────────────────────────────────────────────────────
  app.get("/api/credentials", async (req, res) => {
    const creds = await storage.getCredentials();
    if (!creds) return res.json({ connected: false });
    res.json({ connected: true, environment: creds.environment, apiKeyId: creds.apiKeyId.substring(0, 8) + "..." });
  });

  app.post("/api/credentials", async (req, res) => {
    const { apiKeyId, privateKeyPem, environment } = req.body;
    if (!apiKeyId || !privateKeyPem) {
      return res.status(400).json({ error: "apiKeyId and privateKeyPem required" });
    }
    try {
      const bal = await getBalance(apiKeyId, privateKeyPem.trim(), environment ?? "production");
      await storage.setCredentials({ apiKeyId, privateKeyPem: privateKeyPem.trim(), environment: environment ?? "production" });
      res.json({ success: true, balance: bal });
    } catch (e: any) {
      res.status(401).json({ error: "Invalid credentials: " + e.message });
    }
  });

  app.delete("/api/credentials", async (req, res) => {
    await storage.deleteCredentials();
    res.json({ success: true });
  });

  // ── Bot Settings ─────────────────────────────────────────────────────────
  app.get("/api/settings", async (req, res) => {
    const settings = await storage.getBotSettings();
    res.json(settings);
  });

  app.post("/api/settings", async (req, res) => {
    const updated = await storage.updateBotSettings(req.body);
    if (req.body.pollInterval !== undefined) await restartEngine();
    res.json(updated);
  });

  app.patch("/api/settings", async (req, res) => {
    const updated = await storage.updateBotSettings(req.body);
    if (req.body.pollInterval !== undefined) await restartEngine();
    res.json(updated);
  });

  // ── Market Data ──────────────────────────────────────────────────────────
  app.get("/api/markets/kxbtcd", async (req, res) => {
    try {
      const creds = await storage.getCredentials();
      const env = creds?.environment ?? "production";
      const state = getState();
      const markets = await getKxbtcdMarkets(env, state.btcPrice);
      res.json({ markets });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/btcprice", async (req, res) => {
    try {
      const price = await getBtcPrice();
      res.json({ price });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Portfolio ─────────────────────────────────────────────────────────────
  app.get("/api/portfolio/balance", async (req, res) => {
    const creds = await storage.getCredentials();
    if (!creds) return res.status(401).json({ error: "No credentials configured" });
    try {
      const balance = await getBalance(creds.apiKeyId, creds.privateKeyPem, creds.environment);
      res.json({ balance });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Trade History ─────────────────────────────────────────────────────────
  app.get("/api/trades", async (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50");
    const trades = await storage.getTrades(limit);
    res.json({ trades });
  });

  app.delete("/api/trades", async (req, res) => {
    try {
      await storage.clearTrades();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Engine State ──────────────────────────────────────────────────────────
  app.get("/api/engine/state", async (req, res) => {
    res.json(getState());
  });
}
