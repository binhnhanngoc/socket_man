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

export interface Transport {
  /** Open a WS connection. `onFrame` receives ARRAYS of frames (matches the
   *  prototype's array-shaped addFrames). Returns the connId. */
  wsConnect(
    cfg: ConnectConfig,
    onFrame: (f: Frame[]) => void,
    onStatus: (s: ConnStatus) => void
  ): Promise<string>;
  wsSend(connId: string, payload: string): Promise<void>;
  wsDisconnect(connId: string): Promise<void>;
  httpSend(req: HttpRequest): Promise<HttpResponse>;
}
