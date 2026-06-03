import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EnvEditor } from "./env-editor";
import { ToastHost } from "./toast-host";
import { dismissAll } from "../hooks/use-toasts";
import { transport } from "../transport";
import type { Environment } from "../types";

const envWithSecret: Environment = {
  id: "env-1",
  name: "Staging",
  color: "leaf",
  vars: [{ id: "v1", key: "token", value: "atk_live_secret", secret: true }],
};

afterEach(() => {
  dismissAll();
  vi.restoreAllMocks();
});

describe("EnvEditor keychain feedback", () => {
  it("shows an error toast naming the key when secretSet rejects, and still saves", async () => {
    const spy = vi.spyOn(transport, "secretSet").mockRejectedValue(new Error("keychain locked"));
    const onSave = vi.fn();

    render(
      <>
        <EnvEditor env={envWithSecret} isNew={false} onSave={onSave} onDelete={() => {}} onClose={() => {}} />
        <ToastHost />
      </>
    );

    fireEvent.click(screen.getByText("Save changes"));

    // Fail-closed: the env still persists (as a ref) despite the keychain error.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("token");
    expect(alert.textContent).toMatch(/keychain/i);
    // Never leak the secret VALUE in toast text.
    expect(alert.textContent).not.toContain("atk_live_secret");
    expect(spy).toHaveBeenCalled();
  });

  it("shows a success toast when the save completes cleanly", async () => {
    vi.spyOn(transport, "secretSet").mockResolvedValue();

    render(
      <>
        <EnvEditor env={envWithSecret} isNew={false} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />
        <ToastHost />
      </>
    );

    fireEvent.click(screen.getByText("Save changes"));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/saved/i);
  });
});
