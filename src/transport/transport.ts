// Transport interface + types — the single seam between the React UI and the
// networking layer. Phase 1 ships a MOCK implementation; Phase 2 swaps in the
// real Tauri/Rust transport with NO component changes.
//
// These type NAMES mirror the Rust IPC contract exactly. Phase 1 keeps the
// surface MINIMAL (F24): ConnectConfig is just { url, headers }. The reliability
// / TLS fields (heartbeatSecs, reconnect, insecureTls) are added in Phase 3,
// when they are first honored — extending optional fields later is non-breaking.

export interface ConnectConfig {
  url: string;
  /** Sent on the WS upgrade request — includes Authorization. (The whole reason
   *  for a Rust transport: the browser WebSocket API can't set upgrade headers.) */
  headers: Record<string, string>;
  /** Heartbeat interval (seconds). Hardcoded 30 in v1; omitted → Rust default. */
  heartbeatSecs?: number;
  /** Auto-reconnect. Only `enabled` is user-facing; backoff cap is a hardcoded 30s. */
  reconnect?: { enabled: boolean; maxBackoffSecs?: number };
  /** Disables ALL TLS verification for this one connection (full MITM exposure).
   *  Default off; opt-in per connection with a visible warning. */
  insecureTls?: boolean;
}

export type FrameDir = "in" | "out" | "sys";

export interface Frame {
  id: number;
  dir: FrameDir;
  kind: string;
  body: unknown;
  ts: number;
  size: number;
}

export type ConnStatusKind = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface ConnStatus {
  connId: string;
  status: ConnStatusKind;
  connectedAt?: number;
  reason?: string;
  code?: number;
  rttMs?: number;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timingMs: number;
  sizeBytes: number;
}

/** Identifies the active environment + its secret var keys so Rust can resolve
 *  `{{secretKey}}` tokens on the outbound path. The plaintext values are pulled
 *  from the OS keychain Rust-side — they never travel through this object. */
export interface SecretRefs {
  envId: string;
  secretKeys: string[];
}

export interface Transport {
  /** Open a WS connection. `onFrame` receives ARRAYS of frames (matches the
   *  prototype's array-shaped addFrames). Returns the connId. `secrets` lets Rust
   *  resolve secret tokens in the URL/headers at connect. */
  wsConnect(
    cfg: ConnectConfig,
    onFrame: (f: Frame[]) => void,
    onStatus: (s: ConnStatus) => void,
    secrets?: SecretRefs
  ): Promise<string>;
  wsSend(connId: string, payload: string, secrets?: SecretRefs): Promise<void>;
  wsDisconnect(connId: string): Promise<void>;
  httpSend(req: HttpRequest, secrets?: SecretRefs): Promise<HttpResponse>;

  // ---- persistence (Phase 5) ----
  /** Load a JSON document by name (`collections`/`environments`/`history`). Returns
   *  `null` when the document does not exist yet. */
  storageLoad(name: string): Promise<unknown>;
  storageSave(name: string, data: unknown): Promise<void>;
  /** Write a secret value to the OS keychain. There is deliberately NO `secretGet`
   *  — secret reads happen Rust-side only, on the outbound path. */
  secretSet(envId: string, key: string, value: string): Promise<void>;
  secretDelete(envId: string, key: string): Promise<void>;
  /** Append one TEMPLATE-form entry to history (Rust caps + serializes it). */
  historyAppend(entry: unknown): Promise<void>;

  // ---- export (Track 1) ----
  /** Save text to a user-chosen file. Opens a native "Save As" dialog seeded with
   *  `suggestedName` + `filters`; `contentFor(ext)` produces the bytes for the chosen
   *  extension (lets one dialog offer e.g. .json AND .txt). Returns the written path,
   *  or `null` if the user cancelled. Exports carry TEMPLATES only — never resolved
   *  secret values. The mock transport (browser/Vitest) falls back to a Blob download. */
  exportSave(
    suggestedName: string,
    filters: { name: string; extensions: string[] }[],
    contentFor: (ext: string) => string
  ): Promise<string | null>;
}
