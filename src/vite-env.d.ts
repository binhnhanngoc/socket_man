/// <reference types="vite/client" />

// Typed Vite env vars used by the transport selector (transport/index.ts).
interface ImportMetaEnv {
  /** Force the transport: "mock" (Vitest/browser) or "tauri" (real backend). */
  readonly VITE_TRANSPORT?: "mock" | "tauri";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
