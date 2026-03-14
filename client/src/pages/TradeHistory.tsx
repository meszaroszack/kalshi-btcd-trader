import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, TrendingDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

const VERSION_COLORS = [
  "rgba(201,168,76,0.8)","rgba(139,92,246,0.8)","rgba(16,185,129,0.8)",
  "rgba(245,158,11,0.8)","rgba(236,72,153,0.8)","rgba(14,165,233,0.8)",
  "rgba(239,68,68,0.8)","rgba(251,146,60,0.8)",
];
const vColor = (v: number) => VERSION_COLORS[(v - 1) % VERSION_COLORS.length];
const vBorderClass = (v: number) => `v-color-${((v - 1) % 8) + 1}`;

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "won" ? "badge-won" :
    status === "lost" ? "badge-lost" :
    status === "filled" ? "badge-filled" : "badge-settled";
  return <span className={cls}>{status.toUpperCase()}</span>;
}

function formatTime(d: any) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TradeHistory() {
  const { data: tradesData } = useQuery<any>({ queryKey: ["/api/trades"], refetchInterval: 5000 });
  const { data: logData } = useQuery<any>({ queryKey: ["/api/settings/log"] });
  const [filterVersion, setFilterVersion] = useState<number | null>(null);

  const allTrades = tradesData?.trades ?? [];
  const trades = filterVersion ? allTrades.filter((t: any) => t.settingsVersion === filterVersion) : allTrades;

  const totalPnL = trades.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
  const wins = trades.filter((t: any) => t.status === "won").length;
  const losses = trades.filter((t: any) => t.status === "lost").length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const totalSpent = trades.reduce((s: number, t: any) => s + (t.totalCost ?? 0), 0);
  const avgWin = wins > 0 ? trades.filter((t: any) => t.status === "won").reduce((s: number, t: any) => s + (t.pnl ?? 0), 0) / wins : 0;
  const avgLoss = losses > 0 ? trades.filter((t: any) => t.status === "lost").reduce((s: number, t: any) => s + (t.pnl ?? 0), 0) / losses : 0;


  // Reconciliation
  const totalWinnings = trades.filter((t: any) => t.status === "won").reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
  const totalLosses = Math.abs(trades.filter((t: any) => t.status === "lost").reduce((s: number, t: any) => s + (t.pnl ?? 0), 0));
  const pendingCost = trades.filter((t: any) => t.status === "filled" || t.status === "settled" && t.pnl == null).reduce((s: number, t: any) => s + (t.totalCost ?? 0), 0);
  const [startingBalance, setStartingBalance] = useState<string>("");
  const startNum = parseFloat(startingBalance) || 0;
  const expectedBalance = startNum > 0 ? startNum + totalWinnings - totalLosses : null;

  // All known versions
  const versions = Array.from(new Set(allTrades.map((t: any) => t.settingsVersion ?? 1))) as number[];

  return (
    <div className="min-h-screen">
      <nav className="glass-nav sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-3">
          <Link href="/">
            <button className="glass-btn p-2 text-[#F4EFE6]/50 hover:text-[#F4EFE6]/90"><ArrowLeft size={15} /></button>
          </Link>
          <span className="text-sm font-semibold text-[#F4EFE6]/80">Trade History</span>
          <div className="ml-auto text-xs text-[#7A7468]">{allTrades.length} trades</div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-5 py-6 space-y-4">

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass p-4">
            <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mb-1">Total P&L</div>
            <div className={cn("text-xl font-bold", totalPnL >= 0 ? "text-green-400" : "text-red-400")}>
              {totalPnL >= 0 ? "+" : ""}${Math.abs(totalPnL).toFixed(2)}
            </div>
          </div>
          <div className="glass p-4">
            <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mb-1">Win Rate</div>
            <div className="text-xl font-bold text-[#F4EFE6]/80">{winRate.toFixed(0)}%</div>
            <div className="text-xs text-[#F4EFE6]/30 mt-0.5">{wins}W / {losses}L</div>
          </div>
          <div className="glass p-4">
            <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mb-1">Avg Win / Loss</div>
            <div className="text-sm font-semibold text-green-400">+${avgWin.toFixed(2)}</div>
            <div className="text-sm font-semibold text-red-400">${avgLoss.toFixed(2)}</div>
          </div>
          <div className="glass p-4">
            <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mb-1">Total Spent</div>
            <div className="text-xl font-bold text-[#F4EFE6]/60">${totalSpent.toFixed(2)}</div>
          </div>
        </div>


        {/* Reconciliation */}
        <div className="glass p-4 space-y-3">
          <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest">Balance Reconciliation</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#7A7468] flex-shrink-0">Starting balance $</span>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 22.27"
              value={startingBalance}
              onChange={e => setStartingBalance(e.target.value)}
              className="glass-btn px-3 py-1.5 text-xs w-28 text-[#F4EFE6]/80 bg-[#C9A84C]/5 rounded-lg border border-[#C9A84C]/15 focus:outline-none focus:border-[#C9A84C]/35"
            />
            {expectedBalance !== null && (
              <span className="text-xs text-[#7A7468]">→ Expected: <span className={expectedBalance >= startNum ? "text-green-400 font-bold" : "text-red-400 font-bold"}>${expectedBalance.toFixed(2)}</span></span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-[#C9A84C]/3 border border-[#C9A84C]/8">
              <div className="text-[#7A7468] mb-0.5">Total won</div>
              <div className="text-green-400 font-mono font-semibold">+${totalWinnings.toFixed(2)}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#C9A84C]/3 border border-[#C9A84C]/8">
              <div className="text-[#7A7468] mb-0.5">Total lost</div>
              <div className="text-red-400 font-mono font-semibold">-${totalLosses.toFixed(2)}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#C9A84C]/3 border border-[#C9A84C]/8">
              <div className="text-[#7A7468] mb-0.5">Net P&L</div>
              <div className={cn("font-mono font-semibold", totalWinnings - totalLosses >= 0 ? "text-green-400" : "text-red-400")}>
                {totalWinnings - totalLosses >= 0 ? "+" : ""}${(totalWinnings - totalLosses).toFixed(2)}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[#C9A84C]/3 border border-[#C9A84C]/8">
              <div className="text-[#7A7468] mb-0.5">Pending / unresolved</div>
              <div className="text-yellow-400 font-mono font-semibold">${pendingCost.toFixed(2)}</div>
            </div>
          </div>
          {expectedBalance !== null && (
            <div className={cn("text-xs px-3 py-2 rounded-lg border", Math.abs(expectedBalance - startNum) < 0.05 ? "border-green-400/20 text-green-400 bg-green-400/5" : "border-yellow-400/20 text-yellow-400 bg-yellow-400/5")}>
              {Math.abs(expectedBalance - startNum) < 0.05
                ? "✓ Accounting checks out"
                : `⚠ Gap of $${Math.abs(expectedBalance - (parseFloat(startingBalance) || 0)).toFixed(2)} — may be pending settlements or Kalshi fees`}
            </div>
          )}
        </div>

        {/* Version filter pills */}
        {versions.length > 1 && (
          <div className="glass p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Filter size={12} className="text-[#F4EFE6]/30" />
              <span className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mr-1">Filter by settings version:</span>
              <button
                onClick={() => setFilterVersion(null)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all glass-btn",
                  filterVersion === null ? "glass-btn-green" : "text-[#F4EFE6]/40"
                )}
              >All</button>
              {versions.map(v => {
                const color = vColor(v);
                const snap = logData?.log?.find((e: any) => e.version === v);
                const snapData = snap ? JSON.parse(snap.snapshot ?? "{}") : null;
                return (
                  <button key={v}
                    onClick={() => setFilterVersion(filterVersion === v ? null : v)}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all glass-btn flex items-center gap-1.5",
                      filterVersion === v ? "opacity-100" : "opacity-60 hover:opacity-90"
                    )}
                    style={filterVersion === v ? { borderColor: color, color } : {}}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                    v{v}
                    {snapData && <span className="text-[9px] opacity-60 ml-0.5">+{snapData.profitTarget}%/-{snapData.stopLoss}%</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Settings version legend */}
        {logData?.log?.length > 0 && (
          <div className="glass p-4 space-y-2">
            <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest">Settings Versions</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {logData.log.map((entry: any) => {
                const snap = JSON.parse(entry.snapshot ?? "{}");
                const color = vColor(entry.version);
                const vTrades = allTrades.filter((t: any) => (t.settingsVersion ?? 1) === entry.version);
                const vWins = vTrades.filter((t: any) => t.status === "won").length;
                const vLosses = vTrades.filter((t: any) => t.status === "lost").length;
                const vPnl = vTrades.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
                return (
                  <div key={entry.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/2 border border-white/5">
                    <span className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color }}>v{entry.version}</span>
                        <span className="text-[10px] text-[#F4EFE6]/30">{new Date(entry.changedAt).toLocaleString()}</span>
                      </div>
                      <div className="text-[10px] text-[#F4EFE6]/40 mt-0.5 flex gap-3 flex-wrap">
                        <span>Risk {snap.riskPercent}% · Target +{snap.profitTarget}% · Stop -{snap.stopLoss}%</span>
                        <span>Threshold {snap.swingThreshold}% · Poll {snap.pollInterval}s</span>
                      </div>
                      <div className="text-[10px] mt-1 flex gap-3">
                        <span className="text-[#F4EFE6]/40">{vTrades.length} trades</span>
                        <span className={vWins > vLosses ? "text-green-400" : "text-[#F4EFE6]/40"}>{vWins}W/{vLosses}L</span>
                        <span className={vPnl >= 0 ? "text-green-400" : "text-red-400"}>{vPnl >= 0 ? "+" : ""}${vPnl.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Time-of-day performance breakdown */}
        {trades.length >= 5 && (() => {
          // Bucket trades into hour blocks
          const hourBuckets: Record<string, { trades: any[] }> = {};
          trades.forEach((t: any) => {
            if (!t.createdAt) return;
            const h = new Date(t.createdAt).getHours();
            const label = `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
            if (!hourBuckets[label]) hourBuckets[label] = { trades: [] };
            hourBuckets[label].trades.push(t);
          });
          const buckets = Object.entries(hourBuckets)
            .map(([label, { trades: ts }]) => {
              const w = ts.filter((t: any) => t.status === "won").length;
              const l = ts.filter((t: any) => t.status === "lost").length;
              const pnl = ts.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
              const wr = w + l > 0 ? w / (w + l) : 0;
              return { label, count: ts.length, w, l, pnl, wr };
            })
            .sort((a, b) => {
              // sort by hour
              const toNum = (s: string) => { const h = parseInt(s); const pm = s.includes("pm"); return pm && h !== 12 ? h + 12 : (!pm && h === 12 ? 0 : h); };
              return toNum(a.label) - toNum(b.label);
            });
          const maxCount = Math.max(...buckets.map(b => b.count), 1);
          return (
            <div className="glass p-4">
              <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mb-3">Performance by Hour</div>
              <div className="space-y-2">
                {buckets.map(b => (
                  <div key={b.label} className="flex items-center gap-3">
                    <div className="text-[10px] font-mono text-[#F4EFE6]/40 w-10 flex-shrink-0">{b.label}</div>
                    <div className="flex-1 relative h-5 flex items-center">
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", b.pnl >= 0 ? "bg-green-400" : "bg-red-400")}
                          style={{ width: `${(b.count / maxCount) * 100}%`, opacity: 0.4 + b.wr * 0.6 }}
                        />
                      </div>
                    </div>
                    <div className="text-[10px] text-[#F4EFE6]/40 w-12 text-right">{b.w}W/{b.l}L</div>
                    <div className={cn("text-[10px] font-mono w-14 text-right font-semibold", b.pnl >= 0 ? "text-green-400" : "text-red-400")}>
                      {b.pnl >= 0 ? "+" : ""}${b.pnl.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Full trade table */}
        <div className="glass p-4">
          <div className="text-[10px] text-[#F4EFE6]/35 uppercase tracking-widest mb-3">
            {filterVersion ? `v${filterVersion} trades` : "All Trades"} ({trades.length})
          </div>
          {trades.length === 0 ? (
            <div className="text-sm text-[#F4EFE6]/20 text-center py-8">No trades</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-[#F4EFE6]/25 uppercase tracking-widest">
                    <th className="text-left pb-2 pr-3 font-medium">v</th>
                    <th className="text-left pb-2 pr-3 font-medium">Market</th>
                    <th className="text-left pb-2 pr-3 font-medium">Side</th>
                    <th className="text-right pb-2 pr-3 font-medium">Cost</th>
                    <th className="text-left pb-2 pr-3 font-medium">Status</th>
                    <th className="text-right pb-2 pr-3 font-medium">P&L</th>
                    <th className="text-right pb-2 pr-3 font-medium">BTC @</th>
                    <th className="text-left pb-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t: any) => {
                    const v = t.settingsVersion ?? 1;
                    const color = vColor(v);
                    return (
                      <tr key={t.id} className={cn("glass-table-row border-l-2 pl-3", vBorderClass(v))}>
                        <td className="py-2 pr-3">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
                        </td>
                        <td className="py-2 pr-3 font-mono text-[#F4EFE6]/40 text-[11px] truncate max-w-[110px]">{t.ticker?.split("-").slice(-2).join("-")}</td>
                        <td className="py-2 pr-3">
                          <span className={cn("font-bold text-[11px]", t.side === "yes" ? "text-green-400" : "text-red-400")}>{t.side?.toUpperCase()}</span>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-[#F4EFE6]/55">${t.totalCost?.toFixed(2)}</td>
                        <td className="py-2 pr-3"><StatusBadge status={t.status} /></td>
                        <td className={cn("py-2 pr-3 text-right font-mono font-semibold",
                          t.pnl == null ? "text-[#F4EFE6]/20" : t.pnl >= 0 ? "text-green-400" : "text-red-400"
                        )}>
                          {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : <span className="text-[10px] font-normal text-[#F4EFE6]/20">pending</span>}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-[#F4EFE6]/30 text-[10px]">
                          {t.btcPriceAtTrade ? `$${Math.round(t.btcPriceAtTrade).toLocaleString()}` : "—"}
                        </td>
                        <td className="py-2 text-[#F4EFE6]/30 text-[10px] whitespace-nowrap">{formatTime(t.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="text-center text-[10px] text-[#F4EFE6]/15 pb-4">Powered by Perplexity Computer</div>
      </main>
    </div>
  );
}
