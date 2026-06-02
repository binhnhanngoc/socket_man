// Real Tauri/Rust transport. Calls the Rust `ws_connect`/`ws_send`/`ws_disconnect`
// commands and receives frames + status over an `ipc::Channel`.
//
// NOTE (F6): `channel.onmessage` is a PROPERTY SETTER in Tauri v2
// (`channel.onmessage = cb`) — NOT an awaitable method. The IPC research report's
// `await channel.onmessage(cb)` snippet is wrong; do not copy it.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { ConnStatus, Frame, HttpRequest, HttpResponse, Transport } from "./transport";

// Mirror of the Rust `ChannelMsg` enum (#[serde(tag = "t", rename_all = "camelCase")]).
type ChannelMsg =
  | { t: "frames"; batch: Frame[] }
  | { t: "status"; status: ConnStatus }
  | { t: "error"; message: string; code?: number };

let SYS_SEQ = 0;

export const tauriTransport: Transport = {
  wsConnect(cfg, onFrame, onStatus) {
    const channel = new Channel<ChannelMsg>();
    channel.onmessage = (m) => {
      if (m.t === "frames") {
        onFrame(m.batch);
      } else if (m.t === "status") {
        onStatus(m.status);
      } else {
        // Surface a transport error as a sys frame so it shows in the live log.
        // The Rust side also emits a `disconnected` status right after, which
        // updates the connection chip.
        onFrame([
          { id: -1 * ++SYS_SEQ, dir: "sys", kind: "error", body: { message: m.message, code: m.code }, ts: Date.now(), size: 0 },
        ]);
      }
    };
    return invoke<string>("ws_connect", { config: cfg, channel });
  },

  wsSend(connId, payload) {
    return invoke<void>("ws_send", { connId, payload });
  },

  wsDisconnect(connId) {
    return invoke<void>("ws_disconnect", { connId });
  },

  httpSend(_req: HttpRequest): Promise<HttpResponse> {
    // Real HTTP transport lands in Phase 4 (`http_send` reqwest command). No caller
    // in Phase 2 (HttpWorkspace is still static); reject clearly if invoked early.
    return Promise.reject(new Error("http_send is implemented in Phase 4"));
  },
};
