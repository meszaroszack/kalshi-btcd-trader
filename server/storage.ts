import * as fs from "fs";
import * as path from "path";
import {
  type Credentials, type InsertCredentials,
  type BotSettings, type InsertBotSettings,
  type Trade, type InsertTrade,
  type Signal, type InsertSignal,
  type SettingsLog, type InsertSettingsLog,
} from "@shared/schema";

export interface IStorage {
  getCredentials(): Promise<Credentials | null>;
  setCredentials(creds: InsertCredentials): Promise<Credentials>;
  deleteCredentials(): Promise<void>;

  getBotSettings(): Promise<BotSettings>;
  updateBotSettings(settings: Partial<InsertBotSettings>): Promise<BotSettings>;

  getTrades(limit?: number): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(id: number, update: Partial<InsertTrade>): Promise<Trade>;

  getSignals(limit?: number): Promise<Signal[]>;
  createSignal(signal: InsertSignal): Promise<Signal>;

  getSettingsLog(): Promise<SettingsLog[]>;
  addSettingsLog(entry: InsertSettingsLog): Promise<SettingsLog>;
}

// ── File-based persistent storage ───────────────────────────────────────────
// Data dir: prefer /data (Railway volume) → fallback /tmp/kalshi-btcd-data
// This survives container restarts within a session and is readable on reload.

const DATA_DIR = fs.existsSync("/data")
  ? "/data"
  : path.join(process.cwd(), ".kalshi-data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CREDS_FILE    = path.join(DATA_DIR, "credentials.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const TRADES_FILE   = path.join(DATA_DIR, "trades.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
    }
  } catch {}
  return fallback;
}

function writeJson(file: string, data: unknown) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[storage] write error:", e);
  }
}

const DEFAULT_SETTINGS: BotSettings = {
  id: 1,
  enabled: false,
  riskPercent: 5,
  minConfidence: 65,
  targetBalance: 100,
  pollInterval: 30,
  minCushionPct: 0.3,
  minNoPrice: 65,
  settingsVersion: 1,
};

class FileStorage implements IStorage {
  private creds: Credentials | null = null;
  private settings: BotSettings = { ...DEFAULT_SETTINGS };
  private tradeList: Trade[] = [];
  private signalList: Signal[] = [];
  private settingsLogList: SettingsLog[] = [];
  private tradeIdCounter = 1;
  private signalIdCounter = 1;
  private settingsLogIdCounter = 1;
  private credIdCounter = 1;

  constructor() {
    // Load persisted data on startup
    const savedCreds = readJson<Credentials | null>(CREDS_FILE, null);
    if (savedCreds) {
      this.creds = savedCreds;
      this.credIdCounter = (savedCreds.id ?? 0) + 1;
      console.log("[storage] Loaded credentials from disk");
    }

    const savedSettings = readJson<BotSettings | null>(SETTINGS_FILE, null);
    if (savedSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
      console.log("[storage] Loaded settings from disk:", this.settings);
    }

    const savedTrades = readJson<Trade[]>(TRADES_FILE, []);
    if (savedTrades.length) {
      this.tradeList = savedTrades;
      this.tradeIdCounter = Math.max(...savedTrades.map(t => t.id)) + 1;
      console.log(`[storage] Loaded ${savedTrades.length} trades from disk`);
    }
  }

  async getCredentials(): Promise<Credentials | null> {
    return this.creds;
  }

  async setCredentials(c: InsertCredentials): Promise<Credentials> {
    this.creds = { ...c, id: this.credIdCounter++ };
    writeJson(CREDS_FILE, this.creds);
    return this.creds;
  }

  async deleteCredentials(): Promise<void> {
    this.creds = null;
    if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
  }

  async getBotSettings(): Promise<BotSettings> {
    return { ...this.settings };
  }

  async updateBotSettings(update: Partial<InsertBotSettings>): Promise<BotSettings> {
    const hadMeaningfulChange = Object.keys(update).some(
      k => k !== "enabled" && (update as any)[k] !== (this.settings as any)[k]
    );
    if (hadMeaningfulChange) {
      const newVersion = this.settings.settingsVersion + 1;
      this.settingsLogList.push({
        id: this.settingsLogIdCounter++,
        version: newVersion,
        snapshot: JSON.stringify({ ...this.settings, ...update, settingsVersion: newVersion }),
        changedAt: new Date(),
        label: null,
      });
      update.settingsVersion = newVersion;
    }
    this.settings = { ...this.settings, ...update };
    writeJson(SETTINGS_FILE, this.settings);
    return { ...this.settings };
  }

  async getTrades(limit = 200): Promise<Trade[]> {
    return [...this.tradeList].reverse().slice(0, limit);
  }

  async createTrade(t: InsertTrade): Promise<Trade> {
    const trade: Trade = {
      ...t,
      id: this.tradeIdCounter++,
      createdAt: new Date(),
      orderId: t.orderId ?? null,
      pnl: t.pnl ?? null,
      signalReason: t.signalReason ?? null,
      btcPriceAtTrade: t.btcPriceAtTrade ?? null,
      marketTitle: t.marketTitle ?? null,
      resolvedAt: t.resolvedAt ?? null,
      settingsVersion: t.settingsVersion ?? this.settings.settingsVersion,
    };
    this.tradeList.push(trade);
    writeJson(TRADES_FILE, this.tradeList);
    return trade;
  }

  async updateTrade(id: number, update: Partial<InsertTrade>): Promise<Trade> {
    const idx = this.tradeList.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Trade ${id} not found`);
    this.tradeList[idx] = { ...this.tradeList[idx], ...update };
    writeJson(TRADES_FILE, this.tradeList);
    return this.tradeList[idx];
  }

  async getSignals(limit = 50): Promise<Signal[]> {
    return [...this.signalList].reverse().slice(0, limit);
  }

  async createSignal(s: InsertSignal): Promise<Signal> {
    const signal: Signal = {
      ...s,
      id: this.signalIdCounter++,
      createdAt: new Date(),
      marketTicker: s.marketTicker ?? null,
      marketYesPrice: s.marketYesPrice ?? null,
      rsi: s.rsi ?? null,
      macd: s.macd ?? null,
      macdSignal: s.macdSignal ?? null,
      reasoning: s.reasoning ?? null,
    };
    this.signalList.push(signal);
    return signal;
  }

  async getSettingsLog(): Promise<SettingsLog[]> {
    return [...this.settingsLogList].reverse();
  }

  async addSettingsLog(entry: InsertSettingsLog): Promise<SettingsLog> {
    const log: SettingsLog = {
      ...entry,
      id: this.settingsLogIdCounter++,
      changedAt: new Date(),
      label: entry.label ?? null,
    };
    this.settingsLogList.push(log);
    return log;
  }
}

export const storage = new FileStorage();
