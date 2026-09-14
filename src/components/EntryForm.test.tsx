import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryForm } from "./EntryForm";
import type { Entry } from "../lib/tauri";

// EntryForm receives `onSave`/`onCancel` as props, so plain `vi.fn()` doubles
// are the seam here. It never touches `src/lib/tauri.ts`, so no module mock.

// Querying by label proves the accessibility contract and the behaviour at
// once: if a label stops naming its input, these tests go red.
const siteField = () => screen.getByLabelText("Sitio web");
const usernameField = () => screen.getByLabelText("Usuario");
const passwordField = () => screen.getByLabelText(/^Contraseña/);
const notesField = () => screen.getByLabelText("Notas (opcional)");

// The stored password is present on the fixture on purpose: without it, an
// assertion that the password field starts empty would pass even if the form
// did prefill it.
const STORED_PASSWORD = "stored-secret";

const existingEntry: Entry = {
  id: "entry-1",
  site_url: "github.com",
  username: "ada",
  password: STORED_PASSWORD,
  notes: "work account",
  created_at: 0,
  updated_at: 0,
};

/** Resolves to `true` the way a successful save does. */
const saveSucceeds = () => vi.fn().mockResolvedValue(true);

function renderNew(onSave = saveSucceeds(), onCancel = vi.fn()) {
  const user = userEvent.setup();
  const view = render(<EntryForm onSave={onSave} onCancel={onCancel} />);
  return { ...view, onSave, onCancel, user };
}

function renderEditing(onSave = saveSucceeds(), onCancel = vi.fn()) {
  const user = userEvent.setup();
  const view = render(
    <EntryForm entry={existingEntry} onSave={onSave} onCancel={onCancel} />
  );
  return { ...view, onSave, onCancel, user };
}

describe("EntryForm", () => {
  it("announces whether it is creating or editing an entry", () => {
    const { unmount } = renderNew();
    expect(screen.getByText("Nueva entrada")).toBeInTheDocument();
    unmount();

    renderEditing();
    expect(screen.getByText("Editar entrada")).toBeInTheDocument();
  });

  it("prefills the known fields when editing but never the password", () => {
    renderEditing();

    expect(siteField()).toHaveValue("github.com");
    expect(usernameField()).toHaveValue("ada");
    expect(notesField()).toHaveValue("work account");
    // The stored password must not reach the field even when the caller hands
    // it over: the user retypes it to change it, or leaves it alone.
    expect(passwordField()).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(STORED_PASSWORD);
    // Editing says so: the field invites a new password and spells out that
    // leaving it alone keeps the stored one.
    expect(passwordField()).toHaveAttribute("placeholder", "Nueva contraseña...");
    expect(
      screen.getByText("(dejá vacío para no cambiarla)")
    ).toBeInTheDocument();
  });

  it("saves a new entry with trimmed values", async () => {
    const { onSave, user } = renderNew();

    await user.type(siteField(), "  github.com  ");
    await user.type(usernameField(), "  ada  ");
    await user.type(passwordField(), "s3cret");
    await user.type(notesField(), "  work account  ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith({
      site_url: "github.com",
      username: "ada",
      password: "s3cret",
      notes: "work account",
    });
  });

  it("omits notes entirely when the field is left blank", async () => {
    const { onSave, user } = renderNew();

    await user.type(siteField(), "github.com");
    await user.type(usernameField(), "ada");
    await user.type(passwordField(), "s3cret");
    await user.type(notesField(), "   ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ notes: undefined })
    );
  });

  it("refuses to save without a site and says so", async () => {
    const { onSave, user } = renderNew();

    await user.type(usernameField(), "ada");
    await user.type(passwordField(), "s3cret");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("El sitio no puede estar vacío")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses to save without a username and says so", async () => {
    const { onSave, user } = renderNew();

    await user.type(siteField(), "github.com");
    await user.type(passwordField(), "s3cret");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("El usuario no puede estar vacío")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses to create an entry with no password and says so", async () => {
    const { onSave, user } = renderNew();

    await user.type(siteField(), "github.com");
    await user.type(usernameField(), "ada");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      screen.getByText("La contraseña no puede estar vacía")
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("treats whitespace as empty rather than as a site name", async () => {
    const { onSave, user } = renderNew();

    await user.type(siteField(), "   ");
    await user.type(usernameField(), "ada");
    await user.type(passwordField(), "s3cret");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("El sitio no puede estar vacío")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reports an absent password as null when editing", async () => {
    const { onSave, user } = renderEditing();

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // An empty password while editing means "leave it alone". The form cannot
    // read the stored password, so it says so out of band instead.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ password: null })
    );
  });

  it("reports an untouched password differently from any value a user could type", async () => {
    const untouched = vi.fn().mockResolvedValue(true);
    const first = renderEditing(untouched);
    await first.user.click(screen.getByRole("button", { name: "Guardar" }));
    first.unmount();

    const typed = vi.fn().mockResolvedValue(true);
    const second = renderEditing(typed);
    await second.user.type(passwordField(), "__KEEP__");
    await second.user.click(screen.getByRole("button", { name: "Guardar" }));

    // A password manager's data space is every possible string, so no in-band
    // value can mean "keep the old one" without colliding with a real password
    // somebody might actually have.
    expect(untouched.mock.calls[0][0].password).not.toBe(
      typed.mock.calls[0][0].password
    );
  });

  it("sends the typed password when editing and the user supplies one", async () => {
    const { onSave, user } = renderEditing();

    await user.type(passwordField(), "rotated");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ password: "rotated" })
    );
  });

  it("keeps the password masked until the user asks to see it", async () => {
    const { user } = renderNew();

    const field = passwordField();
    expect(field).toHaveAttribute("type", "password");

    await user.click(screen.getByTitle("Mostrar"));
    expect(field).toHaveAttribute("type", "text");

    await user.click(screen.getByTitle("Ocultar"));
    expect(field).toHaveAttribute("type", "password");
  });

  it("fills and reveals a generated password", async () => {
    const { user } = renderNew();

    const field = passwordField();
    await user.click(screen.getByTitle("Generar contraseña segura"));

    expect((field as HTMLInputElement).value).toHaveLength(20);
    // Revealing it is the point: the user has to be able to read what was
    // generated before saving it.
    expect(field).toHaveAttribute("type", "text");
  });

  it("closes on cancel and on a click outside the dialog", async () => {
    const { onCancel, user } = renderNew();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("Nueva entrada"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const overlay = document.querySelector(".modal-overlay");
    await user.click(overlay as Element);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("closes from the dialog's own close control", async () => {
    const { onCancel, user } = renderNew();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks a second submit while the first one is in flight", async () => {
    let finishSave: (ok: boolean) => void = () => {};
    const onSave = vi.fn(
      () => new Promise<boolean>(resolve => { finishSave = resolve; })
    );
    const { user } = renderNew(onSave);

    await user.type(siteField(), "github.com");
    await user.type(usernameField(), "ada");
    await user.type(passwordField(), "s3cret");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const submit = screen.getByRole("button", { name: "Guardando..." });
    expect(submit).toBeDisabled();

    await user.click(submit);
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSave(true);
    });
  });

  it("lets the user try again after a failed save", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const { user } = renderNew(onSave);

    await user.type(siteField(), "github.com");
    await user.type(usernameField(), "ada");
    await user.type(passwordField(), "s3cret");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const submit = await screen.findByRole("button", { name: "Guardar" });
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
