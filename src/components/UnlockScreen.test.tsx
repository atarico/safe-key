import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnlockScreen } from "./UnlockScreen";

// UnlockScreen has no dependency on `src/lib/tauri.ts`; it receives
// `onUnlock`/`onCreate` as props, so plain `vi.fn()` doubles are the seam
// here. No `vi.mock` of the port module is needed for this suite.

describe("UnlockScreen", () => {
  it("renders the last vault path prefilled when provided", () => {
    render(
      <UnlockScreen
        initialVaultPath="/home/user/vault.db"
        onUnlock={vi.fn()}
        onCreate={vi.fn()}
        loading={false}
        error={null}
      />
    );

    expect(
      screen.getByPlaceholderText("/home/user/Dropbox/safekey.db")
    ).toHaveValue("/home/user/vault.db");
  });

  it("calls onUnlock with the entered vault path and master password on submit", async () => {
    const onUnlock = vi.fn();
    const user = userEvent.setup();

    render(
      <UnlockScreen onUnlock={onUnlock} onCreate={vi.fn()} loading={false} error={null} />
    );

    await user.type(
      screen.getByPlaceholderText("/home/user/Dropbox/safekey.db"),
      "/home/user/vault.db"
    );
    await user.type(
      screen.getByPlaceholderText("Tu contraseña maestra"),
      "correct horse battery staple"
    );
    await user.click(screen.getByRole("button", { name: "Desbloquear" }));

    expect(onUnlock).toHaveBeenCalledWith(
      "/home/user/vault.db",
      "correct horse battery staple"
    );
  });

  it("displays an error message when unlocking fails", () => {
    render(
      <UnlockScreen
        onUnlock={vi.fn()}
        onCreate={vi.fn()}
        loading={false}
        error="Contraseña incorrecta"
      />
    );

    expect(screen.getByText("Contraseña incorrecta")).toBeInTheDocument();
  });
});
