import { useState, useEffect } from "react";
import { Link } from "wouter";

function ChipMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
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

interface Settings {
  riskPercent: number;
  minConfidence: number;
  targetBalance: number;
  pollInterval: number;
  minCushionPct: number;
  minNoPrice: number;
  enabled: boolean;
}

function SettingRow({ label, desc, value, onChange, min, max, step, suffix }: {
  label: string; desc: string; value: number;
  onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string;
}) {
  const [inputVal, setInputVal] = useState(String(value));
  useEffect(() => { setInputVal(String(value)); }, [value]);

  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid #2E2B26" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, color: "#F4EFE6", fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 12, color: "#7A7468", marginTop: 2 }}>{desc}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number" min={min} max={max} step={step}
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onBlur={() => {
              const n = parseFloat(inputVal);
              if (!isNaN(n)) { onChange(Math.max(min, Math.min(max, n))); }
              else { setInputVal(String(value)); }
            }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                const n = parseFloat(inputVal);
                if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
              }
            }}
            style={{
              width: 72, padding: "6px 10px", background: "#0D0C0A", border: "1px solid #2E2B26",
              borderRadius: 8, color: "#C9A84C", fontSize: 14, fontWeight: 600, textAlign: "right",
              fontFamily: "'Space Grotesk', sans-serif", outline: "none",
            }}
          />
          {suffix && <span style={{ color: "#7A7468", fontSize: 13 }}>{suffix}</span>}
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => { const v = parseFloat(e.target.value); onChange(v); setInputVal(String(v)); }}
        style={{ width: "100%", accentColor: "#C9A84C", cursor: "pointer" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7A7468", marginTop: 2 }}>
        <span>{min}{suffix}</span><span>{max}{suffix}</span>
      </div>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<Settings>({
    riskPercent: 5, minConfidence: 65, targetBalance: 100,
    pollInterval: 30, minCushionPct: 0.3, minNoPrice: 65, enabled: false,
  });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [creds, setCreds] = useState({ apiKeyId: "", privateKeyPem: "" });
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsError, setCredsError] = useState("");
  const [existingKeyId, setExistingKeyId] = useState<string | null>(null);

  useEffect(() => {
    // Load current settings from server
    fetch("/api/settings")
      .then(r => r.json())
      .then(d => {
        if (d && d.riskPercent !== undefined) {
          setSettings({
            riskPercent: d.riskPercent ?? 5,
            minConfidence: d.minConfidence ?? 65,
            targetBalance: d.targetBalance ?? 100,
            pollInterval: d.pollInterval ?? 30,
            minCushionPct: d.minCushionPct ?? 0.3,
            minNoPrice: d.minNoPrice ?? 65,
            enabled: d.enabled ?? false,
          });
        }
      })
      .catch(() => {
        fetch("/api/state").then(r => r.json()).then(d => {
          if (d.settings) setSettings(d.settings);
        });
      });

    // Check if credentials are already saved
    fetch("/api/credentials")
      .then(r => r.json())
      .then(d => {
        if (d.connected && d.apiKeyId) {
          setExistingKeyId(d.apiKeyId);
        }
      })
      .catch(() => {});
  }, []);

  const update = (key: keyof Settings) => (val: number) => setSettings(s => ({ ...s, [key]: val }));

  const save = async () => {
    setSaveError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setSaveError(errData.error ?? `Server error ${res.status}`);
        return;
      }
      const confirmed = await res.json();
      // Update local state with server-confirmed values
      setSettings({
        riskPercent: confirmed.riskPercent ?? settings.riskPercent,
        minConfidence: confirmed.minConfidence ?? settings.minConfidence,
        targetBalance: confirmed.targetBalance ?? settings.targetBalance,
        pollInterval: confirmed.pollInterval ?? settings.pollInterval,
        minCushionPct: confirmed.minCushionPct ?? settings.minCushionPct,
        minNoPrice: confirmed.minNoPrice ?? settings.minNoPrice,
        enabled: confirmed.enabled ?? settings.enabled,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setSaveError("Network error — settings may not have saved");
    }
  };

  const saveCreds = async () => {
    setCredsError("");
    if (!creds.apiKeyId.trim() || !creds.privateKeyPem.trim()) {
      setCredsError("Both fields are required"); return;
    }
    const res = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKeyId: creds.apiKeyId.trim(), privateKeyPem: creds.privateKeyPem.trim(), environment: "production" }),
    });
    if (res.ok) {
      setCredsSaved(true);
      setExistingKeyId(creds.apiKeyId.trim().substring(0, 8) + "...");
      setCreds({ apiKeyId: "", privateKeyPem: "" });
      setTimeout(() => setCredsSaved(false), 2000);
    } else {
      const errData = await res.json().catch(() => ({}));
      setCredsError(errData.error ?? "Failed to save credentials");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0D0C0A", color: "#F4EFE6", fontFamily: "'Space Grotesk', sans-serif" }}>
      <nav style={{ borderBottom: "1px solid #2E2B26", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChipMark size={28} />
          <div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#C9A84C" }}>COMP'D</div>
            <div style={{ fontSize: 10, color: "#7A7468", letterSpacing: "0.08em" }}>HOURLY BTC DECAY</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/"><button style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", color: "#C9A84C", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Dashboard</button></Link>
          <Link href="/history"><button style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", color: "#C9A84C", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>History</button></Link>
        </div>
      </nav>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
        <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, color: "#C9A84C", marginBottom: 6 }}>Strategy Settings</h2>
        <p style={{ fontSize: 13, color: "#7A7468", marginBottom: 24 }}>
          Decay strategy: buy NO on strikes BTC is safely below, collect premium as time runs out.
        </p>

        {/* Strategy settings */}
        <div style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: "0 20px 4px" }}>
          <SettingRow label="Risk Per Trade" desc="% of balance to risk on each decay entry" value={settings.riskPercent} onChange={update("riskPercent")} min={1} max={20} step={0.5} suffix="%" />
          <SettingRow label="Min Confidence" desc="Signal confidence threshold to enter a trade" value={settings.minConfidence} onChange={update("minConfidence")} min={40} max={95} step={1} suffix="%" />
          <SettingRow label="Target Balance" desc="Bot auto-pauses when balance reaches this" value={settings.targetBalance} onChange={update("targetBalance")} min={10} max={1000} step={5} suffix="$" />
          <SettingRow label="Min Cushion" desc="Minimum % BTC must be below the strike to enter NO" value={settings.minCushionPct} onChange={update("minCushionPct")} min={0.1} max={2.0} step={0.05} suffix="%" />
          <SettingRow label="Min NO Price" desc="Minimum price in cents to accept for a NO contract (higher = more premium)" value={settings.minNoPrice} onChange={update("minNoPrice")} min={50} max={95} step={1} suffix="¢" />
          <SettingRow label="Poll Interval" desc="How often to check markets (30s is ideal for hourly markets)" value={settings.pollInterval} onChange={update("pollInterval")} min={10} max={120} step={5} suffix="s" />
        </div>

        {saveError && (
          <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#ef4444", fontSize: 13 }}>
            {saveError}
          </div>
        )}

        <button
          onClick={save}
          style={{
            width: "100%", marginTop: 16, padding: "13px 0", borderRadius: 10, border: "none", cursor: "pointer",
            background: saved ? "rgba(74,222,128,0.15)" : "rgba(201,168,76,0.15)",
            color: saved ? "#4ade80" : "#C9A84C",
            border: `1px solid ${saved ? "rgba(74,222,128,0.4)" : "rgba(201,168,76,0.3)"}`,
            fontSize: 14, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", transition: "all 0.2s",
          } as any}
        >
          {saved ? "✓ Saved" : "Save Settings"}
        </button>

        {/* API Credentials */}
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 16, color: "#C9A84C", fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>API Credentials</h3>
          <p style={{ fontSize: 12, color: "#7A7468", marginBottom: 16 }}>
            Kalshi RSA key pair. Credentials are saved to disk and persist across restarts.
            {existingKeyId && (
              <span style={{ color: "#4ade80", marginLeft: 6 }}>✓ Connected: {existingKeyId}</span>
            )}
          </p>
          <div style={{ background: "#1A1815", border: "1px solid #2E2B26", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              placeholder={existingKeyId ? `Current: ${existingKeyId} — enter new to replace` : "Access Key ID"}
              value={creds.apiKeyId}
              onChange={e => setCreds(c => ({ ...c, apiKeyId: e.target.value }))}
              style={{ padding: "10px 12px", background: "#0D0C0A", border: "1px solid #2E2B26", borderRadius: 8, color: "#F4EFE6", fontSize: 13, fontFamily: "monospace", outline: "none" }}
            />
            <textarea
              placeholder="Private Key PEM (-----BEGIN RSA PRIVATE KEY-----...)"
              rows={5}
              value={creds.privateKeyPem}
              onChange={e => setCreds(c => ({ ...c, privateKeyPem: e.target.value }))}
              style={{ padding: "10px 12px", background: "#0D0C0A", border: "1px solid #2E2B26", borderRadius: 8, color: "#F4EFE6", fontSize: 12, fontFamily: "monospace", outline: "none", resize: "vertical" }}
            />
            {credsError && <div style={{ color: "#ef4444", fontSize: 12 }}>{credsError}</div>}
            <button
              onClick={saveCreds}
              style={{
                padding: "10px 0", borderRadius: 8, border: "none", cursor: "pointer",
                background: credsSaved ? "rgba(74,222,128,0.15)" : "rgba(201,168,76,0.08)",
                color: credsSaved ? "#4ade80" : "#C9A84C",
                border: `1px solid ${credsSaved ? "rgba(74,222,128,0.4)" : "rgba(201,168,76,0.2)"}`,
                fontSize: 13, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
              } as any}
            >
              {credsSaved ? "✓ Credentials Saved" : "Save Credentials"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: "#7A7468" }}>
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" style={{ color: "#7A7468", textDecoration: "none" }}>
            COMP'D · Created with Perplexity Computer
          </a>
        </div>
      </div>
    </div>
  );
}
