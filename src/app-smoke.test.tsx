// App boot smoke test: mounts the full component tree (driven by the mock
// Transport) and exercises a basic interaction. Catches runtime regressions from
// the port — bad imports, hook misuse, undefined globals — without a browser.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import App from "./App";

describe("App boots through the mock transport", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the core workbench chrome without crashing", () => {
    render(<App />);
    // Brand + the three panes that prove the tree mounted.
    expect(screen.getByText("Atomiton")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Compose message")).toBeInTheDocument();
    // Default WS item is selected; its connect button is present.
    expect(screen.getByRole("button", { name: /Connect/i })).toBeInTheDocument();
  });

  it("opens the Tweaks panel from the Settings gear (no host protocol)", () => {
    render(<App />);
    expect(screen.queryByText("Tweaks")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Settings"));
    expect(screen.getByText("Tweaks")).toBeInTheDocument();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });

  it("shows the not-connected empty state for the default WS item", () => {
    render(<App />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });
});
