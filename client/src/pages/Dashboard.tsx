import { useEffect, useState, useRef } from "react";
import { useSSE } from "../hooks/useSSE";
import { Link } from "wouter";

// ── ChipMark SVG ─────────────────────────────────────────────────────
function ChipMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="COMP'D chip mark">
      <circle cx="32" cy="32" r="30" fill="#0D0C0A" stroke="#C9A84C" strokeWidth="3"/>
      <circle cx="32" cy="32" r="23" fill="#1A1815"/>
      {[0,45,90,135,180,225,270,315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 32 + 23 * Math.cos(rad);
        const y1 = 32 + 23 * Math.sin(rad);
        const x2 = 32 + 30 * Math.cos(rad);
        const y2 = 32 + 30 * Math.sin(rad);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#C9A84C" strokeWidth="4" strokeLinecap="round"/>;
      })}
      <path d="M20 32 L28 40 L44 24" stroke="#C9A84C" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

export default function Dashboard() {
  const { state: sseData, connected, notification } = useSSE();
  const [isOn, setIsOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch("/api/state").then(r => r.json()).then(d => {
      setIsOn(d.settings?.enabled ?? false);
    });
  }, []);

  // Draw BTC price chart with strike lines
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const prices: Array<{ time: number; price: number }> = sseData?.priceHistory ?? [];
    const markets: any[] = sseData?.availableMarkets ?? [];
    if (prices.length < 2) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const vals = prices.map(p => p.price);
    // Include strike prices in range calculation
    const strikes = markets.slice(0, 5).map((m: any) => m.strikePrice).filter(Boolean);
    const allVals = [...vals, ...strikes];
    let minV = Math.min(...allVals);
    let maxV = Math.max(...allVals);
    const pad = (maxV - minV) * 0.15 || 200;
    minV -= pad; maxV += pad;
    const range = maxV - minV || 1;

    const toX = (i: number) => (i / (prices.length - 1)) * W;
    const toY = (v: number) => H - ((v - minV) / range) * H;

    // Background grid
    ctx.strokeStyle = "rgba(201,168,76,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Strike price lines for nearby markets
    markets.slice(0, 6).forEach((m: any) => {
      if (!m.strikePrice) return;
      const y = toY(m.strikePrice);
      if (y < 0 || y > H) return;
      const isAbove = m.side === "above";
      // Color: above strike = danger red if close, green if far. Below = inverse
      const btcPrice = vals[vals.length - 1] ?? 0;
      const distPct = ((m.strikePrice - btcPrice) / btcPrice) * 100;
      const isFar = Math.abs(distPct) > 0.5;
      ctx.strokeStyle = isFar ? "rgba(201,168,76,0.4)" : "rgba(239,68,68,0.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.fillStyle = isFar ? "rgba(201,168,76,0.7)" : "rgba(239,68,68,0.9)";
      ctx.font = "10px Space Grotesk, sans-serif";
      ctx.fillText(`$${m.strikePrice.toLocaleString()} ${isAbove ? "▲" : "▼"}`, 4, y - 3);
    });

    // BTC price gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(201,168,76,0.25)");
    grad.addColorStop(1, "rgba(201,168,76,0)");
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    prices.forEach((p, i) => { if (i > 0) ctx.lineTo(toX(i), toY(p.price)); });
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // BTC line
    ctx.beginPath();
    ctx.strokeStyle = "#C9A84C";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    prices.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(0), toY(p.price));
      else ctx.lineTo(toX(i), toY(p.price));
    });
    ctx.stroke();

    // Current price dot
    const lastX = toX(prices.length - 1);
    const lastY = toY(vals[vals.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#C9A84C"; ctx.fill();
  }, [sseData?.priceHistory, sseData?.availableMarkets]);

  const toggleBot = async () => {
    setLoading(true);
    const newState = !isOn;
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState }),
      });
      setIsOn(newState);
    } finally { setLoading(false); }
  };

  const btcPrice = sseData?.btcPrice ?? 0;
  const balance = sseData?.balance ?? 0;
  const netLiq = sseData?.netLiqValue ?? balance;
  const signal = sseData?.decaySignal;
  const activeTrade = sseData?.activeDecayTrade;
  const currentMarket = sseData?.currentMarket;
  const availableMarkets: any[] = sseData?.availableMarkets ?? [];
  const recentTrades: any[] = sseData?.recentTrades ?? [];

  // Active position P&L
  let openPnl = 0;
  if (activeTrade && currentMarket) {
    const bid = activeTrade.side === "no" ? currentMarket.no_bid : currentMarket.yes_bid;
    openPnl = bid > 0 ? ((bid - activeTrade.entryPriceInCents) / 100) * activeTrade.count : 0;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D0C0A", color: "#F4EFE6", fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* Nav */}
      <nav style={{ borderBottom: "1px solid #2E2B26", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChipMark size={30} />
          <div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#C9A84C", lineHeight: 1 }}>COMP'D</div>
            <div style={{ fontSize: 10, color: "#7A7468", letterSpacing: "0.08em", textTransform: "uppercase" }}>Hourly BTC Decay</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: isOn ? "#4ade80" : "#7A7468", background: isOn ? "rgba(74,222,128,0.1)" : "rgba(122,116,104,0.1)", padding: "4px 10px", borderRadius: 20, border: `1px solid ${isOn ? "rgba(74,222,128,0.3)" : "rgba(122,116,104,0.3)"}` }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isOn ? "#4ade80" : "#7A7468", display: "inline-block" }} />
            {isOn ? "LIVE" : "OFF"}
          </span>
          <Link href="/history"><button style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", color: "#C9A84C", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>History</button></Link>
          <Link href="/settings"><button style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", color: "#C9A84C", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>⚙ Settings</button></Link>
        </div>
      </nav>

      {/* SSE notification toast */}
      {notification && (
        <div style={{
          position: "fixed", top: 68, right: 20, zIndex: 1000,
          background: "#1A1815", border: "1px solid rgba(201,168,76,0.4)",
          borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#F4EFE6",
          maxWidth: 360, boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          {notification}
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: "BTC PRICE", value: btcPrice > 0 ? `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—", sub: "", icon: "₿" },
            { label: "BALANCE", value: `$${balance.toFixed(2)}`, sub: `Target $${sseData?.settings?.targetBalance ?? 100}`, icon: "◈" },
            { label: "NET VALUE", value: `$${netLiq.toFixed(2)}`, sub: activeTrade ? `open P&L ${openPnl >= 0 ? "+" : ""}$${openPnl.toFixed(2)}` : "no open position", icon: "⚡" },
            { label: "SIGNAL", value: signal?.shouldEnter ? signal.side.toUpperCase() : "WATCHING", sub: signal ? `${signal.confidence?.toFixed(0)}% conf` : "scanning…", icon: "◉" },
            { label: "AVAILABLE", value: `${availableMarkets.length}`, sub: "markets this hour", icon: "⏱" },
          ].map(s => (
            <div key={s.label} style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 10, color: "#7A7468", letterSpacing: "0.1em", marginBottom: 6 }}>{s.label}</div>
                <span style={{ fontSize: 14, color: "#C9A84C", opacity: 0.6 }}>{s.icon}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#F4EFE6" }}>{s.value}</div>
              {s.sub && <div style={{ fontSize: 11, color: "#7A7468", marginTop: 4 }}>{s.sub}</div>}
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
          {/* Chart */}
          <div style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#7A7468", letterSpacing: "0.08em" }}>BTC LIVE PRICE + STRIKE LEVELS</span>
              <span style={{ fontSize: 11, color: "#7A7468" }}>Updated {new Date().toLocaleTimeString()}</span>
            </div>
            <canvas ref={chartRef} width={680} height={200} style={{ width: "100%", height: 200, display: "block", borderRadius: 6 }} />
            <div style={{ marginTop: 10, fontSize: 11, color: "#7A7468" }}>
              Dashed lines = strike prices | Gold = safe | Red = danger zone (&lt;0.5% cushion)
            </div>
          </div>

          {/* Right panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Bot toggle */}
            <div style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#7A7468", letterSpacing: "0.08em", marginBottom: 12 }}>BOT CONTROL</div>
              <button
                onClick={toggleBot}
                disabled={loading}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer",
                  background: isOn ? "rgba(239,68,68,0.15)" : "rgba(74,222,128,0.15)",
                  color: isOn ? "#ef4444" : "#4ade80",
                  border: `1px solid ${isOn ? "rgba(239,68,68,0.4)" : "rgba(74,222,128,0.4)"}`,
                  fontSize: 14, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
                  transition: "all 0.2s",
                } as any}
              >
                {loading ? "…" : isOn ? "■ STOP BOT" : "▶ START BOT"}
              </button>
              {sseData?.lastExitReason && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#7A7468", lineHeight: 1.4 }}>
                  Last exit: {sseData.lastExitReason}
                </div>
              )}
            </div>

            {/* Active trade */}
            {activeTrade && (
              <div style={{ background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, color: "#C9A84C", letterSpacing: "0.08em", marginBottom: 8 }}>ACTIVE DECAY TRADE</div>
                <div style={{ fontSize: 13, color: "#F4EFE6", marginBottom: 4 }}>
                  {activeTrade.side.toUpperCase()} × {activeTrade.count} @ {activeTrade.entryPriceInCents}¢
                </div>
                <div style={{ fontSize: 11, color: "#7A7468", marginBottom: 4 }}>
                  Strike: ${activeTrade.strikePrice?.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "#7A7468", marginBottom: 4 }}>
                  Stop: {activeTrade.stopPriceInCents}¢ | Target: {activeTrade.targetPriceInCents}¢
                </div>
                <div style={{ fontSize: 13, color: openPnl >= 0 ? "#4ade80" : "#ef4444", fontWeight: 600 }}>
                  P&L: {openPnl >= 0 ? "+" : ""}${openPnl.toFixed(2)}
                </div>
              </div>
            )}

            {/* Signal */}
            {signal && (
              <div style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, color: "#7A7468", letterSpacing: "0.08em", marginBottom: 8 }}>DECAY SIGNAL</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: signal.shouldEnter ? "#4ade80" : "#7A7468" }}>
                    {signal.shouldEnter ? `${signal.side.toUpperCase()} ENTRY` : "WAITING"}
                  </span>
                  <span style={{ fontSize: 12, color: "#C9A84C" }}>{signal.confidence?.toFixed(0)}%</span>
                </div>
                <div style={{ fontSize: 11, color: "#7A7468", lineHeight: 1.5 }}>{signal.reasoning}</div>
              </div>
            )}

            {/* Market list */}
            <div style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: 14, flex: 1 }}>
              <div style={{ fontSize: 11, color: "#7A7468", letterSpacing: "0.08em", marginBottom: 8 }}>NEARBY STRIKES</div>
              {availableMarkets.slice(0, 5).map((m: any) => {
                const isCurrent = m.ticker === currentMarket?.ticker;
                const dist = m.distancePct ?? 0;
                const isDanger = Math.abs(dist) < 0.3;
                return (
                  <div key={m.ticker} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "5px 0", borderBottom: "1px solid #2E2B26", fontSize: 12,
                  }}>
                    <div>
                      <span style={{ color: isCurrent ? "#C9A84C" : "#F4EFE6" }}>${m.strikePrice?.toLocaleString()}</span>
                      <span style={{ color: isDanger ? "#ef4444" : "#7A7468", fontSize: 11, marginLeft: 6 }}>
                        {dist >= 0 ? "+" : ""}{dist.toFixed(2)}%
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ color: "#4ade80", fontSize: 11 }}>NO {m.no_bid}¢</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Recent trades */}
        {recentTrades.length > 0 && (
          <div style={{ marginTop: 16, background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#7A7468", letterSpacing: "0.08em" }}>RECENT TRADES</span>
              <Link href="/history"><span style={{ fontSize: 12, color: "#C9A84C", cursor: "pointer" }}>View all →</span></Link>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "#7A7468", textAlign: "left" }}>
                  {["MARKET", "SIDE", "COST", "STATUS", "P&L", "SIGNAL", "TIME"].map(h => (
                    <th key={h} style={{ paddingBottom: 8, fontWeight: 400, letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentTrades.slice(0, 5).map((t: any) => (
                  <tr key={t.id} style={{ borderTop: "1px solid #2E2B26" }}>
                    <td style={{ padding: "8px 0", color: "#F4EFE6" }}>{t.ticker}</td>
                    <td><span style={{ color: t.side === "no" ? "#C9A84C" : "#60a5fa" }}>{t.side?.toUpperCase()}</span></td>
                    <td style={{ color: "#F4EFE6" }}>${t.totalCost?.toFixed(2)}</td>
                    <td><span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 11,
                      background: t.status === "won" ? "rgba(74,222,128,0.15)" : t.status === "lost" ? "rgba(239,68,68,0.15)" : "rgba(201,168,76,0.1)",
                      color: t.status === "won" ? "#4ade80" : t.status === "lost" ? "#ef4444" : "#C9A84C",
                    }}>{t.status?.toUpperCase()}</span></td>
                    <td style={{ color: (t.pnl ?? 0) >= 0 ? "#4ade80" : "#ef4444" }}>
                      {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "—"}
                    </td>
                    <td style={{ color: "#7A7468", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.signalReason ?? "—"}</td>
                    <td style={{ color: "#7A7468" }}>{t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Attribution */}
        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: "#7A7468" }}>
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" style={{ color: "#7A7468", textDecoration: "none" }}>
            COMP'D · Autonomous Trading · Created with Perplexity Computer
          </a>
        </div>
      </div>
    </div>
  );
}
