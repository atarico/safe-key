import { useId, useState } from "react";
import type { Entry, EntryInput } from "../lib/tauri";

/**
 * What the form reports. `password: null` means "leave the stored one alone",
 * said out of band so it cannot collide with a password somebody actually has.
 */
export interface EntryFormValues extends Omit<EntryInput, "password"> {
  password: string | null;
}

interface Props {
  entry?: Entry;
  onSave: (values: EntryFormValues) => Promise<boolean>;
  onCancel: () => void;
}

export function EntryForm({ entry, onSave, onCancel }: Props) {
  const fieldId = useId();
  const [siteUrl, setSiteUrl] = useState(entry?.site_url ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When editing, password field starts empty (user must re-enter to change it)
  const isEditing = !!entry;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!siteUrl.trim()) {
      setError("El sitio no puede estar vacío");
      return;
    }
    if (!username.trim()) {
      setError("El usuario no puede estar vacío");
      return;
    }
    if (!password && !isEditing) {
      setError("La contraseña no puede estar vacía");
      return;
    }

    setSaving(true);
    const ok = await onSave({
      site_url: siteUrl.trim(),
      username: username.trim(),
      password: password || null,
      notes: notes.trim() || undefined,
    });

    if (!ok) setSaving(false);
  };

  const generatePassword = () => {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const array = new Uint32Array(20);
    crypto.getRandomValues(array);
    const pwd = Array.from(array)
      .map(n => chars[n % chars.length])
      .join("");
    setPassword(pwd);
    setShowPassword(true);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEditing ? "Editar entrada" : "Nueva entrada"}</h2>
          <button
            className="btn-icon"
            onClick={onCancel}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor={`${fieldId}-site`}>Sitio web</label>
            <input
              id={`${fieldId}-site`}
              type="text"
              value={siteUrl}
              onChange={e => setSiteUrl(e.target.value)}
              placeholder="github.com"
              autoFocus
              disabled={saving}
            />
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-username`}>Usuario</label>
            <input
              id={`${fieldId}-username`}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="tu@email.com"
              disabled={saving}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-password`}>
              Contraseña
              {isEditing && (
                <span className="field-hint"> (dejá vacío para no cambiarla)</span>
              )}
            </label>
            <div className="input-with-actions">
              <input
                id={`${fieldId}-password`}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isEditing ? "Nueva contraseña..." : "Contraseña"}
                disabled={saving}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowPassword(v => !v)}
                title={showPassword ? "Ocultar" : "Mostrar"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={generatePassword}
                title="Generar contraseña segura"
              >
                🎲
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-notes`}>Notas (opcional)</label>
            <textarea
              id={`${fieldId}-notes`}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notas adicionales..."
              disabled={saving}
              rows={3}
            />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
