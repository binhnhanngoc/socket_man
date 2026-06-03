// Toast notifications — a module-level singleton store (no context provider),
// mirroring the module-singleton style of `src/transport/index.ts`. Any module
// (async hooks, components) can `pushToast(...)` and the mounted <ToastHost/>
// re-renders via useSyncExternalStore. Keeping state at module scope (not in a
// component) avoids stale-closure bugs when pushing from async handlers.
import { useSyncExternalStore } from "react";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_TTL_MS = 5000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  // New array reference so useSyncExternalStore detects the change.
  for (const listener of listeners) listener();
}

/** Push a toast; returns its id. `ttl` ≤ 0 disables auto-dismiss. */
export function pushToast(t: { kind: ToastKind; message: string; ttl?: number }): number {
  const id = nextId++;
  toasts = [...toasts, { id, kind: t.kind, message: t.message }];
  emit();
  const ttl = t.ttl ?? DEFAULT_TTL_MS;
  if (ttl > 0) timers.set(id, setTimeout(() => dismiss(id), ttl));
  return id;
}

/** Manually dismiss a toast (also clears its auto-dismiss timer). */
export function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

/** Clear every active toast (e.g. between tests, or on a hard view reset). */
export function dismissAll() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (toasts.length) {
    toasts = [];
    emit();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

/** Subscriber hook for the toast host. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
