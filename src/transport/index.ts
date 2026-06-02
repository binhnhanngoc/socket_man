// Transport selector.
//
// Default: use the real Tauri transport when running inside the Tauri webview
// (detected via `__TAURI_INTERNALS__`), otherwise the mock (so Vitest/jsdom and a
// plain `vite dev` in a browser keep working). `VITE_TRANSPORT=mock|tauri` forces
// either explicitly.

import { mockTransport } from "./mock-transport";
import { tauriTransport } from "./tauri-transport";
import type { Transport } from "./transport";

function selectTransport(): Transport {
  const flag = import.meta.env.VITE_TRANSPORT as string | undefined;
  if (flag === "mock") return mockTransport;
  if (flag === "tauri") return tauriTransport;
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  return inTauri ? tauriTransport : mockTransport;
}

export const transport: Transport = selectTransport();

export type {
  ConnectConfig,
  ConnStatus,
  ConnStatusKind,
  Frame,
  FrameDir,
  HttpRequest,
  HttpResponse,
  SecretRefs,
  Transport,
} from "./transport";
