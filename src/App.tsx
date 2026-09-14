import { useState } from "react";
import { useVault } from "./hooks/useVault";
import { UnlockScreen } from "./components/UnlockScreen";
import { EntryList } from "./components/EntryList";
import { EntryForm } from "./components/EntryForm";
import { toEntryInput } from "./lib/entry-save";
import type { Entry } from "./lib/tauri";
import type { EntryFormValues } from "./components/EntryForm";
import "./App.css";

export default function App() {
  const vault = useVault();
  const [editingEntry, setEditingEntry] = useState<Entry | null | "new">(null);

  const handleSave = async (values: EntryFormValues) => {
    if (editingEntry === "new") {
      // The form requires a password before it reports a new entry.
      if (values.password === null) return false;
      const ok = await vault.addEntry({ ...values, password: values.password });
      if (ok) setEditingEntry(null);
      return ok;
    } else if (editingEntry) {
      const ok = await vault.editEntry(
        editingEntry.id,
        await toEntryInput(values, editingEntry.id)
      );
      if (ok) setEditingEntry(null);
      return ok;
    }
    return false;
  };

  if (vault.status !== "unlocked") {
    return (
      <UnlockScreen
        key={vault.lastVaultPath ?? ""}
        initialVaultPath={vault.lastVaultPath ?? ""}
        onUnlock={vault.unlock}
        onCreate={vault.createVault}
        loading={vault.loading}
        error={vault.error}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">🔐</span>
          <h1>Safekey</h1>
        </div>
        <div className="header-right">
          <span className="entry-count">
            {vault.entries.length} entrada{vault.entries.length !== 1 ? "s" : ""}
          </span>
          <button className="btn-icon" onClick={vault.lock} title="Bloquear vault">
            🔒
          </button>
        </div>
      </header>

      <main className="app-main">
        {vault.error && (
          <div className="error-banner global-error" onClick={vault.clearError}>
            {vault.error} <span className="dismiss">✕</span>
          </div>
        )}

        <EntryList
          entries={vault.entries}
          onEdit={entry => setEditingEntry(entry)}
          onDelete={entry => vault.removeEntry(entry.id)}
          onCopyPassword={vault.copyPassword}
        />
      </main>

      <button
        className="fab"
        onClick={() => setEditingEntry("new")}
        title="Nueva entrada"
      >
        +
      </button>

      {editingEntry !== null && (
        <EntryForm
          entry={editingEntry === "new" ? undefined : editingEntry}
          onSave={handleSave}
          onCancel={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
