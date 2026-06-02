// Starter collections, saved messages, and environments — ported from
// design/data.js. Still Atomiton-branded here; the SocketMan rebrand + starter
// data refresh happens in Phase 6.

import type { Collection, Environment, MessageMap } from "../types";

export const ENV_COLOR: Record<string, string> = {
  leaf: "var(--leaf)",
  solar: "var(--solar)",
  pond: "var(--pond)",
  rust: "var(--rust)",
  flare: "var(--flare)",
  clay: "var(--clay)",
  stone: "var(--stone)",
};

export const COLLECTIONS: Collection[] = [
  {
    id: "c-telemetry",
    name: "Plant Telemetry",
    items: [
      { id: "ws-live", kind: "ws", name: "Live sensor stream", url: "wss://relay.atomiton.io/v3/telemetry" },
      { id: "ws-alerts", kind: "ws", name: "Alert bus", url: "wss://relay.atomiton.io/v3/alerts" },
      { id: "http-snap", kind: "http", method: "GET", name: "Snapshot · all BOTs", url: "https://api.atomiton.io/v3/bots/snapshot" },
    ],
  },
  {
    id: "c-scenario",
    name: "Scenario Engine",
    items: [
      { id: "ws-sim", kind: "ws", name: "What-if simulation", url: "wss://relay.atomiton.io/v3/scenario" },
      { id: "http-run", kind: "http", method: "POST", name: "Run scenario", url: "https://api.atomiton.io/v3/scenario/run" },
    ],
  },
  {
    id: "c-grid",
    name: "Grid & Pricing",
    items: [{ id: "ws-price", kind: "ws", name: "Spot price feed", url: "wss://relay.atomiton.io/v3/grid/price" }],
  },
];

export const MESSAGES: MessageMap = {
  "ws-live": [
    { id: "m1", name: "Subscribe · Boiler #3", type: "subscribe", fav: true, body: { action: "subscribe", channel: "boiler.3", fields: ["kwh", "temp_c", "efficiency"] } },
    { id: "m2", name: "Subscribe · Chiller loop", type: "subscribe", fav: true, body: { action: "subscribe", channel: "chiller.loop", fields: ["kwh", "flow_m3h"] } },
    { id: "m3", name: "Subscribe · Water intake", type: "subscribe", fav: false, body: { action: "subscribe", channel: "water.intake", fields: ["flow_m3h", "turbidity"] } },
    { id: "m4", name: "Set sample rate · 5s", type: "config", fav: false, body: { action: "config", sampleInterval: 5, unit: "s" } },
    { id: "m5", name: "Unsubscribe all", type: "control", fav: false, body: { action: "unsubscribe", channel: "*" } },
    { id: "m6", name: "Ping", type: "control", fav: false, body: { action: "ping" } },
  ],
  "ws-alerts": [
    { id: "a1", name: "Subscribe · Critical only", type: "subscribe", fav: true, body: { action: "subscribe", channel: "alerts", minSeverity: "critical" } },
    { id: "a2", name: "Acknowledge alert", type: "control", fav: false, body: { action: "ack", alertId: "AL-0294" } },
    { id: "a3", name: "Subscribe · All severities", type: "subscribe", fav: false, body: { action: "subscribe", channel: "alerts", minSeverity: "info" } },
  ],
  "ws-sim": [
    { id: "s1", name: "Start scenario A", type: "control", fav: true, body: { action: "start", scenario: "A", shift: { bot: "B-021", window: "02:00-05:00" } } },
    { id: "s2", name: "Step forward 1h", type: "control", fav: false, body: { action: "step", hours: 1 } },
    { id: "s3", name: "Reset simulation", type: "control", fav: false, body: { action: "reset" } },
  ],
  "ws-price": [
    { id: "p1", name: "Subscribe · Day-ahead", type: "subscribe", fav: true, body: { action: "subscribe", market: "day-ahead", node: "CAISO-SP15" } },
    { id: "p2", name: "Subscribe · Real-time 5m", type: "subscribe", fav: false, body: { action: "subscribe", market: "rt-5m", node: "CAISO-SP15" } },
  ],
};

export const ENVIRONMENTS: Environment[] = [
  {
    id: "env-prod",
    name: "Production",
    color: "leaf",
    vars: [
      { id: "ev1", key: "ws_url", value: "wss://relay.atomiton.io/v3", secret: false },
      { id: "ev2", key: "base_url", value: "https://api.atomiton.io/v3", secret: false },
      { id: "ev3", key: "token", value: "atk_live_8f2a4d91c0", secret: true },
      { id: "ev4", key: "plant_id", value: "lehigh-valley", secret: false },
    ],
  },
  {
    id: "env-staging",
    name: "Staging",
    color: "solar",
    vars: [
      { id: "ev1", key: "ws_url", value: "wss://relay.staging.atomiton.io/v3", secret: false },
      { id: "ev2", key: "base_url", value: "https://api.staging.atomiton.io/v3", secret: false },
      { id: "ev3", key: "token", value: "atk_test_3b71fe20aa", secret: true },
      { id: "ev4", key: "plant_id", value: "sandbox-01", secret: false },
    ],
  },
  {
    id: "env-local",
    name: "Local",
    color: "pond",
    vars: [
      { id: "ev1", key: "ws_url", value: "ws://localhost:8081/v3", secret: false },
      { id: "ev2", key: "base_url", value: "http://localhost:8080/v3", secret: false },
      { id: "ev3", key: "token", value: "atk_dev_local", secret: true },
    ],
  },
];
