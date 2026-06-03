// Vitest global setup: jest-dom matchers for component assertions.
import "@testing-library/jest-dom/vitest";

// jsdom lacks ResizeObserver, which @tanstack/react-virtual uses for dynamic row
// measurement. A no-op stub keeps virtualized components renderable under Vitest
// (rows fall back to estimateSize, which is fine for smoke/logic tests).
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
