// Transport selector. Phase 1 exports the mock; Phase 2 adds the real Tauri/Rust
// transport and switches this export (detecting the Tauri runtime), with NO
// changes required in any component or hook that imports `transport`.

import { mockTransport } from "./mock-transport";
import type { Transport } from "./transport";

export const transport: Transport = mockTransport;

export type {
  ConnectConfig,
  ConnStatus,
  ConnStatusKind,
  Frame,
  FrameDir,
  HttpRequest,
  HttpResponse,
  Transport,
} from "./transport";
