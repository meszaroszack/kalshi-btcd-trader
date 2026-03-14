import crypto from "crypto";

const PROD_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const DEMO_BASE = "https://demo-api.kalshi.co/trade-api/v2";

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle?: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  close_time: string;
  status: string;
  open_time?: string;
  // KXBTCD-specific
  strikePrice: number;       // the dollar strike (e.g. 71000)
  distancePct: number;       // how far current BTC is from the strike (%)
  side: "above" | "below";   // which side is the YES resolution
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: string;
  action: string;
  count: number;
  status: string;
  yes_price: number;
  no_price: number;
}

function createSignature(privateKeyPem: string, timestamp: string, method: string, path: string): string {
  const pathWithoutQuery = path.split("?")[0];
  const message = `${timestamp}${method}${pathWithoutQuery}`;
  const sign = crypto.createSign("SHA256");
  sign.update(message);
  sign.end();
  const privateKey = crypto.createPrivateKey({ key: privateKeyPem, format: "pem" });
  return sign.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

async function kalshiRequest(
  method: string,
  path: string,
  apiKeyId: string,
  privateKeyPem: string,
  baseUrl: string,
  body?: object
): Promise<any> {
  const timestamp = String(Date.now());
  const fullPath = `/trade-api/v2${path}`;
  const signature = createSignature(privateKeyPem, timestamp, method, fullPath);

  const url = new URL(baseUrl + path);
  const headers: Record<string, string> = {
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
  };

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Kalshi API ${method} ${path} → ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function kalshiPublic(path: string, env: string): Promise<any> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`Kalshi public ${path} → ${response.status}`);
  return response.json();
}

export async function getBalance(apiKeyId: string, privateKeyPem: string, env = "production"): Promise<number> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  const data = await kalshiRequest("GET", "/portfolio/balance", apiKeyId, privateKeyPem, base);
  return (data.balance ?? 0) / 100;
}

// ── KXBTCD MARKET FETCH ─────────────────────────────────────────────────────
// Fetches hourly BTC above/below markets. Returns all open markets with
// parsed strike prices, sorted by proximity to current BTC price.
export async function getKxbtcdMarkets(env = "production", btcPrice = 0): Promise<KalshiMarket[]> {
  const data = await kalshiPublic(`/markets?series_ticker=KXBTCD&status=open&limit=50`, env);

  const markets = (data.markets ?? []).map((m: any) => {
    const parseCents = (dollars: string | undefined, fallbackCents: number) => {
      if (dollars !== undefined && dollars !== null) {
        const v = Math.round(parseFloat(dollars) * 100);
        if (v > 0) return v;
      }
      return fallbackCents;
    };

    const yes_bid = parseCents(m.yes_bid_dollars, m.yes_bid ?? 0);
    const yes_ask = parseCents(m.yes_ask_dollars, m.yes_ask ?? 0);
    const no_bid  = parseCents(m.no_bid_dollars,  m.no_bid  ?? 0);
    const no_ask  = parseCents(m.no_ask_dollars,  m.no_ask  ?? 0);
    const last_price = parseCents(m.last_price_dollars, m.last_price ?? yes_bid);

    // Parse strike from title: "Bitcoin price on Mar 14, 2026? $71,000 or above"
    // or from ticker: KXBTCD-26MAR1417-T81249.99 (T=above, B=below/between)
    let strikePrice = 0;
    let side: "above" | "below" = "above";

    // Try ticker parse first: KXBTCD-26MAR1417-T71000
    const tickerMatch = m.ticker.match(/-(T|B)([\d.]+)$/);
    if (tickerMatch) {
      strikePrice = parseFloat(tickerMatch[2]);
      side = tickerMatch[1] === "T" ? "above" : "below";
    } else {
      // Fallback: parse from title
      const titleMatch = (m.title || "").match(/\$([\d,]+(?:\.\d+)?)/);
      if (titleMatch) strikePrice = parseFloat(titleMatch[1].replace(/,/g, ""));
      side = (m.title || "").toLowerCase().includes("above") ? "above" : "below";
    }

    const distancePct = btcPrice > 0 && strikePrice > 0
      ? ((strikePrice - btcPrice) / btcPrice) * 100
      : 0;

    return {
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      title: m.title,
      subtitle: m.subtitle,
      yes_bid, yes_ask, no_bid, no_ask, last_price,
      volume: m.volume_fp ?? m.volume ?? 0,
      open_interest: m.open_interest_fp ?? m.open_interest ?? 0,
      close_time: m.close_time,
      status: m.status,
      open_time: m.open_time,
      strikePrice,
      distancePct,
      side,
    } as KalshiMarket;
  });

  // Filter to only markets closing in the current hour window, with valid strikes
  const now = Date.now();
  const valid = markets.filter((m: KalshiMarket) => {
    const closeMs = new Date(m.close_time).getTime();
    return closeMs > now && m.strikePrice > 0;
  });

  // Sort by distance from BTC price ascending (nearest first)
  valid.sort((a: KalshiMarket, b: KalshiMarket) =>
    Math.abs(a.distancePct) - Math.abs(b.distancePct)
  );

  return valid;
}

export async function getOpenPositions(apiKeyId: string, privateKeyPem: string, env = "production"): Promise<any[]> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  const data = await kalshiRequest("GET", "/portfolio/positions?settlement_status=unsettled&limit=100", apiKeyId, privateKeyPem, base);
  return data.market_positions ?? [];
}

export async function getSettledPositions(apiKeyId: string, privateKeyPem: string, env = "production"): Promise<any[]> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  try {
    const data = await kalshiRequest("GET", "/portfolio/positions?settlement_status=settled&limit=20", apiKeyId, privateKeyPem, base);
    return data.market_positions ?? [];
  } catch { return []; }
}

export async function getOrderFills(apiKeyId: string, privateKeyPem: string, orderId: string, env = "production"): Promise<any[]> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  try {
    const data = await kalshiRequest("GET", `/portfolio/fills?order_id=${orderId}&limit=10`, apiKeyId, privateKeyPem, base);
    return data.fills ?? [];
  } catch { return []; }
}

export async function placeOrder(
  apiKeyId: string,
  privateKeyPem: string,
  ticker: string,
  side: "yes" | "no",
  action: "buy" | "sell",
  count: number,
  priceInCents: number,
  env = "production"
): Promise<KalshiOrder> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  const body = {
    ticker, action, side, count,
    type: "limit",
    ...(side === "yes" ? { yes_price: priceInCents } : { no_price: priceInCents }),
    client_order_id: crypto.randomUUID(),
  };
  const data = await kalshiRequest("POST", "/portfolio/orders", apiKeyId, privateKeyPem, base, body);
  return data.order;
}

export async function cancelOrder(
  apiKeyId: string,
  privateKeyPem: string,
  orderId: string,
  env = "production"
): Promise<void> {
  const base = env === "demo" ? DEMO_BASE : PROD_BASE;
  await kalshiRequest("DELETE", `/portfolio/orders/${orderId}`, apiKeyId, privateKeyPem, base);
}

export async function getBtcPrice(): Promise<number> {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const json = await res.json();
    return parseFloat(json.data?.amount ?? "0");
  } catch { return 0; }
}
