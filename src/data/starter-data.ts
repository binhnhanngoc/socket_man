// Starter collections, saved messages, and environments for a fresh SocketMan
// install. Vendor-neutral and immediately usable: it points at public echo
// endpoints so a new user can connect/send for real, not at a dead demo. No real
// secret values are committed — the secret var ships empty (set it in the editor;
// the value goes to the OS keychain, never to disk).

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
    id: "c-playground",
    name: "Playground",
    items: [
      { id: "ws-echo", kind: "ws", name: "Echo socket", url: "wss://echo.websocket.events" },
      { id: "http-get", kind: "http", method: "GET", name: "GET request", url: "https://postman-echo.com/get" },
      { id: "http-post", kind: "http", method: "POST", name: "POST request", url: "https://postman-echo.com/post" },
    ],
  },
];

export const MESSAGES: MessageMap = {
  "ws-echo": [
    { id: "m1", name: "Hello", type: "message", fav: true, body: { type: "hello", from: "socketman" } },
    { id: "m2", name: "Subscribe (example)", type: "subscribe", fav: false, body: { action: "subscribe", channel: "demo", fields: ["a", "b"] } },
    { id: "m3", name: "Ping", type: "control", fav: false, body: { action: "ping" } },
  ],
};

export const ENVIRONMENTS: Environment[] = [
  {
    id: "env-local",
    name: "Local",
    color: "pond",
    vars: [
      { id: "ev1", key: "ws_url", value: "wss://echo.websocket.events", secret: false },
      { id: "ev2", key: "base_url", value: "https://postman-echo.com", secret: false },
      // Placeholder secret: empty by design. Set a value in the editor → it is stored
      // in the OS keychain and resolved Rust-side as {{token}} on connect/send.
      { id: "ev3", key: "token", value: "", secret: true },
    ],
  },
];
