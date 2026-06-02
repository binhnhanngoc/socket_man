// data.js — sample collections, saved messages, and a fake WebSocket server.
// Plain JS, attached to window.

// ---- Collections tree -----------------------------------------------------
// kind: 'ws' | 'http'
const COLLECTIONS = [
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
    items: [
      { id: "ws-price", kind: "ws", name: "Spot price feed", url: "wss://relay.atomiton.io/v3/grid/price" },
    ],
  },
];

// ---- Saved message library (per ws connection) ----------------------------
// type tints map to design-system semantic colors via class.
const MESSAGES = {
  "ws-live": [
    { id: "m1", name: "Subscribe · Boiler #3", type: "subscribe", fav: true,
      body: { action: "subscribe", channel: "boiler.3", fields: ["kwh", "temp_c", "efficiency"] } },
    { id: "m2", name: "Subscribe · Chiller loop", type: "subscribe", fav: true,
      body: { action: "subscribe", channel: "chiller.loop", fields: ["kwh", "flow_m3h"] } },
    { id: "m3", name: "Subscribe · Water intake", type: "subscribe", fav: false,
      body: { action: "subscribe", channel: "water.intake", fields: ["flow_m3h", "turbidity"] } },
    { id: "m4", name: "Set sample rate · 5s", type: "config", fav: false,
      body: { action: "config", sampleInterval: 5, unit: "s" } },
    { id: "m5", name: "Unsubscribe all", type: "control", fav: false,
      body: { action: "unsubscribe", channel: "*" } },
    { id: "m6", name: "Ping", type: "control", fav: false,
      body: { action: "ping" } },
  ],
  "ws-alerts": [
    { id: "a1", name: "Subscribe · Critical only", type: "subscribe", fav: true,
      body: { action: "subscribe", channel: "alerts", minSeverity: "critical" } },
    { id: "a2", name: "Acknowledge alert", type: "control", fav: false,
      body: { action: "ack", alertId: "AL-0294" } },
    { id: "a3", name: "Subscribe · All severities", type: "subscribe", fav: false,
      body: { action: "subscribe", channel: "alerts", minSeverity: "info" } },
  ],
  "ws-sim": [
    { id: "s1", name: "Start scenario A", type: "control", fav: true,
      body: { action: "start", scenario: "A", shift: { bot: "B-021", window: "02:00-05:00" } } },
    { id: "s2", name: "Step forward 1h", type: "control", fav: false,
      body: { action: "step", hours: 1 } },
    { id: "s3", name: "Reset simulation", type: "control", fav: false,
      body: { action: "reset" } },
  ],
  "ws-price": [
    { id: "p1", name: "Subscribe · Day-ahead", type: "subscribe", fav: true,
      body: { action: "subscribe", market: "day-ahead", node: "CAISO-SP15" } },
    { id: "p2", name: "Subscribe · Real-time 5m", type: "subscribe", fav: false,
      body: { action: "subscribe", market: "rt-5m", node: "CAISO-SP15" } },
  ],
};

// ---- Fake WebSocket server -------------------------------------------------
// A tiny simulator: holds subscriptions, emits frames on a tick, replies to
// commands. The App drives it via .send() and a tick callback.
function rnd(min, max, dp = 1) {
  const v = min + Math.random() * (max - min);
  return Number(v.toFixed(dp));
}
const CHANNEL_GEN = {
  "boiler.3": () => ({ kwh: rnd(780, 920), temp_c: rnd(305, 332), efficiency: rnd(86, 94) }),
  "chiller.loop": () => ({ kwh: rnd(420, 560), flow_m3h: rnd(180, 240) }),
  "water.intake": () => ({ flow_m3h: rnd(90, 140), turbidity: rnd(0.4, 1.8, 2) }),
};

function makeServer(connId) {
  return {
    subs: new Set(),
    // returns array of reply frames {dir:'in', kind, body}
    handle(body) {
      const replies = [];
      const a = body && body.action;
      if (a === "subscribe") {
        const ch = body.channel || body.market || "stream";
        this.subs.add(ch);
        replies.push({ kind: "ack", body: { ok: true, subscribed: ch, ts: Date.now() } });
      } else if (a === "unsubscribe") {
        if (body.channel === "*") this.subs.clear();
        else this.subs.delete(body.channel);
        replies.push({ kind: "ack", body: { ok: true, unsubscribed: body.channel } });
      } else if (a === "ping") {
        replies.push({ kind: "pong", body: { pong: true, rttMs: rnd(8, 40, 0) } });
      } else if (a === "config") {
        replies.push({ kind: "ack", body: { ok: true, applied: body } });
      } else if (a === "ack") {
        replies.push({ kind: "ack", body: { ok: true, acknowledged: body.alertId } });
      } else if (a === "start" || a === "step" || a === "reset") {
        replies.push({ kind: "event", body: { scenario: body.scenario || "A", state: a, projectedSavingUSD: rnd(180000, 340000, 0) } });
      } else {
        replies.push({ kind: "ack", body: { ok: true, received: a || "message" } });
      }
      return replies;
    },
    // server-initiated frames on each tick
    tick() {
      const frames = [];
      this.subs.forEach((ch) => {
        if (CHANNEL_GEN[ch]) {
          frames.push({ kind: "telemetry", body: { ch, ts: Math.floor(Date.now() / 1000), ...CHANNEL_GEN[ch]() } });
        } else if (ch === "alerts") {
          if (Math.random() < 0.25) frames.push({ kind: "alert", body: { id: "AL-" + (200 + Math.floor(Math.random() * 99)), severity: ["info", "warning", "critical"][Math.floor(Math.random() * 3)], bot: "B-0" + (10 + Math.floor(Math.random() * 30)), msg: "efficiency below baseline" } });
        } else {
          // price feeds
          frames.push({ kind: "tick", body: { node: ch, priceUSDMWh: rnd(28, 76, 2), ts: Math.floor(Date.now() / 1000) } });
        }
      });
      return frames;
    },
    welcome() {
      return { kind: "open", body: { server: "atomiton-relay/3.4.1", region: "us-west", heartbeat: 30, ts: Date.now() } };
    },
  };
}

Object.assign(window, { COLLECTIONS, MESSAGES, makeServer });

// ---- Environments ---------------------------------------------------------
// Named sets of variables. Reference a variable anywhere as {{key}}.
const ENV_COLOR = {
  leaf: "var(--leaf)", solar: "var(--solar)", pond: "var(--pond)",
  rust: "var(--rust)", flare: "var(--flare)", clay: "var(--clay)", stone: "var(--stone)",
};

const ENVIRONMENTS = [
  { id: "env-prod", name: "Production", color: "leaf", vars: [
    { id: "ev1", key: "ws_url", value: "wss://relay.atomiton.io/v3", secret: false },
    { id: "ev2", key: "base_url", value: "https://api.atomiton.io/v3", secret: false },
    { id: "ev3", key: "token", value: "atk_live_8f2a4d91c0", secret: true },
    { id: "ev4", key: "plant_id", value: "lehigh-valley", secret: false },
  ] },
  { id: "env-staging", name: "Staging", color: "solar", vars: [
    { id: "ev1", key: "ws_url", value: "wss://relay.staging.atomiton.io/v3", secret: false },
    { id: "ev2", key: "base_url", value: "https://api.staging.atomiton.io/v3", secret: false },
    { id: "ev3", key: "token", value: "atk_test_3b71fe20aa", secret: true },
    { id: "ev4", key: "plant_id", value: "sandbox-01", secret: false },
  ] },
  { id: "env-local", name: "Local", color: "pond", vars: [
    { id: "ev1", key: "ws_url", value: "ws://localhost:8081/v3", secret: false },
    { id: "ev2", key: "base_url", value: "http://localhost:8080/v3", secret: false },
    { id: "ev3", key: "token", value: "atk_dev_local", secret: true },
  ] },
];

// Replace {{key}} tokens in a string with the active environment's values.
function resolveEnv(str, env) {
  if (!str || !env) return str;
  return str.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => {
    const v = (env.vars || []).find((x) => x.key === k);
    return v ? v.value : m;
  });
}

Object.assign(window, { ENV_COLOR, ENVIRONMENTS, resolveEnv });
