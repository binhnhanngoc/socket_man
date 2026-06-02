// Real Tauri/Rust transport. Calls the Rust `ws_connect`/`ws_send`/`ws_disconnect`
// commands and receives frames + status over an `ipc::Channel`.
//
// NOTE (F6): `channel.onmessage` is a PROPERTY SETTER in Tauri v2
// (`channel.onmessage = cb`) — NOT an awaitable method. The IPC research report's
// `await channel.onmessage(cb)` snippet is wrong; do not copy it.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { ConnStatus, Frame, HttpRequest, HttpResponse, SecretRefs, Transport } from "./transport";

// Tauri converts camelCase JS arg keys to the snake_case Rust command params
// (envId → env_id, secretKeys → secret_keys). An absent env sends an empty key list.
function secretArgs(secrets?: SecretRefs) {
  return { envId: secrets?.envId, secretKeys: secrets?.secretKeys ?? [] };
}

// Mirror of the Rust `ChannelMsg` enum (#[serde(tag = "t", rename_all = "camelCase")]).
type ChannelMsg =
  | { t: "frames"; batch: Frame[] }
  | { t: "status"; status: ConnStatus }
  | { t: "error"; message: string; code?: number };

let SYS_SEQ = 0;

export const tauriTransport: Transport = {
  wsConnect(cfg, onFrame, onStatus, secrets) {
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
    return invoke<string>("ws_connect", { config: cfg, channel, ...secretArgs(secrets) });
  },

  wsSend(connId, payload, secrets) {
    return invoke<void>("ws_send", { connId, payload, ...secretArgs(secrets) });
  },

  wsDisconnect(connId) {
    return invoke<void>("ws_disconnect", { connId });
  },

  httpSend(req: HttpRequest, secrets): Promise<HttpResponse> {
    // The Rust `http_send` command resolves secret tokens (from `secretArgs`) on the
    // outbound path, runs reqwest off the IPC thread, and returns HttpResponse.
    return invoke<HttpResponse>("http_send", { req, ...secretArgs(secrets) });
  },

  storageLoad(name) {
    return invoke<unknown>("storage_load", { name });
  },
  storageSave(name, data) {
    return invoke<void>("storage_save", { name, data });
  },
  secretSet(envId, key, value) {
    return invoke<void>("secret_set", { envId, key, value });
  },
  secretDelete(envId, key) {
    return invoke<void>("secret_delete", { envId, key });
  },
  historyAppend(entry) {
    return invoke<void>("history_append", { entry });
  },
};
