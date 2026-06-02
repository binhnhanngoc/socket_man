// Shared domain types for SocketMan's frontend.
// Transport-facing types (Frame, ConnStatus, ConnectConfig, Http*) live in
// transport/transport.ts so they mirror the Rust IPC contract; this file holds
// the UI/data-model types (collections, messages, environments).

import type { FrameDir } from "./transport/transport";

/** A request endpoint inside a collection: a WS connection or an HTTP request. */
export type ItemKind = "ws" | "http";

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  url: string;
  /** HTTP verb — present only for `kind: "http"`. */
  method?: string;
}

export interface Collection {
  id: string;
  name: string;
  items: Item[];
}

/** A saved, reusable message body for a WS connection. */
export interface SavedMessage {
  id: string;
  name: string;
  type: string;
  fav: boolean;
  body: unknown;
}

/** Map of connection-item id -> its saved messages. */
export type MessageMap = Record<string, SavedMessage[]>;

export interface EnvVar {
  id: string;
  key: string;
  value: string;
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  color: string;
  vars: EnvVar[];
}

/** Live runtime state of a WS connection (frames buffer + status). */
export interface ConnState {
  status: import("./transport/transport").ConnStatusKind;
  frames: import("./transport/transport").Frame[];
  connectedAt: number | null;
}

export type ConnMap = Record<string, ConnState>;

/** Re-export so consumers can grab the frame direction from one place. */
export type { FrameDir };
