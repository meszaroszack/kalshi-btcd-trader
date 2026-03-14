import { pgTable, text, integer, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// API credentials storage
export const credentials = pgTable("credentials", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  apiKeyId: text("api_key_id").notNull(),
  privateKeyPem: text("private_key_pem").notNull(),
  environment: text("environment").notNull().default("production"),
});

export const insertCredentialsSchema = createInsertSchema(credentials).omit({ id: true });
export type InsertCredentials = z.infer<typeof insertCredentialsSchema>;
export type Credentials = typeof credentials.$inferSelect;

// Bot settings — KXBTCD Decay strategy
export const botSettings = pgTable("bot_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  enabled: boolean("enabled").notNull().default(false),
  riskPercent: real("risk_percent").notNull().default(5),         // conservative 5% per trade
  minConfidence: real("min_confidence").notNull().default(65),    // confidence threshold
  targetBalance: real("target_balance").notNull().default(100),
  pollInterval: integer("poll_interval").notNull().default(30),   // 30s poll for hourly markets
  minCushionPct: real("min_cushion_pct").notNull().default(0.3),  // min % BTC must be below strike
  minNoPrice: real("min_no_price").notNull().default(65),         // min NO price in cents
  settingsVersion: integer("settings_version").notNull().default(1),
});

export const insertBotSettingsSchema = createInsertSchema(botSettings).omit({ id: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettings.$inferSelect;

// Settings snapshot log
export const settingsLog = pgTable("settings_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  version: integer("version").notNull(),
  snapshot: text("snapshot").notNull(),
  changedAt: timestamp("changed_at").defaultNow(),
  label: text("label"),
});

export const insertSettingsLogSchema = createInsertSchema(settingsLog).omit({ id: true, changedAt: true });
export type InsertSettingsLog = z.infer<typeof insertSettingsLogSchema>;
export type SettingsLog = typeof settingsLog.$inferSelect;

// Trade log
export const trades = pgTable("trades", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderId: text("order_id"),
  ticker: text("ticker").notNull(),
  side: text("side").notNull(),
  action: text("action").notNull(),
  count: integer("count").notNull(),
  pricePerContract: real("price_per_contract").notNull(),
  totalCost: real("total_cost").notNull(),
  status: text("status").notNull().default("pending"),
  pnl: real("pnl"),
  signalReason: text("signal_reason"),
  btcPriceAtTrade: real("btc_price_at_trade"),
  marketTitle: text("market_title"),
  settingsVersion: integer("settings_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

// Signal log
export const signals = pgTable("signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  direction: text("direction").notNull(),
  confidence: real("confidence").notNull(),
  btcPrice: real("btc_price").notNull(),
  marketTicker: text("market_ticker"),
  marketYesPrice: real("market_yes_price"),
  rsi: real("rsi"),
  macd: real("macd"),
  macdSignal: real("macd_signal"),
  reasoning: text("reasoning"),
  traded: boolean("traded").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signals).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signals.$inferSelect;
