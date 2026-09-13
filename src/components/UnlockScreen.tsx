import { useId, useState } from "react";

interface Props {
  /** Prefilled vault path (last one used). Parent remounts via `key` when it changes. */
  initialVaultPath?: string;
  onUnlock: (vaultPath: string, password: string) => void;
  onCreate: (vaultPath: string, password: string) => void;
  loading: boolean;
  error: string | null;
}

export function UnlockScreen({
  initialVaultPath = "",
  onUnlock,
  onCreate,
  loading,
  error,
}: Props) {
  const fieldId = useId();
  const [mode, setMode] = useState<"unlock" | "create">("unlock");
  const [vaultPath, setVaultPath] = useState(initialVaultPath);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!vaultPath.trim()) {
      setLocalError("Ingresá la ruta del vault");
      return;
    }
    if (!password) {
      setLocalError("Ingresá tu master password");
      return;
    }

    if (mode === "create") {
      if (password !== confirmPassword) {
        setLocalError("Las contraseñas no coinciden");
        return;
      }
      if (password.length < 12) {
        setLocalError("La master password debe tener al menos 12 caracteres");
        return;
      }
      onCreate(vaultPath.trim(), password);
    } else {
      onUnlock(vaultPath.trim(), password);
    }
  };

  const displayError = localError || error;

  return (
    <div className="unlock-screen">
      <div className="unlock-card">
        <div className="unlock-header">
          <div className="logo">🔐</div>
          <h1>Safekey</h1>
          <p className="tagline">Tu vault seguro, siempre en tus manos</p>
        </div>

        <div className="mode-tabs">
          <button
            className={mode === "unlock" ? "active" : ""}
            onClick={() => setMode("unlock")}
          >
            Abrir vault
          </button>
          <button
            className={mode === "create" ? "active" : ""}
            onClick={() => setMode("create")}
          >
            Nuevo vault
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor={`${fieldId}-path`}>Ruta del vault</label>
            <input
              id={`${fieldId}-path`}
              type="text"
              value={vaultPath}
              onChange={e => setVaultPath(e.target.value)}
              placeholder="/home/user/Dropbox/safekey.db"
              disabled={loading}
              autoComplete="off"
            />
            <span className="field-hint">
              Apuntá a tu carpeta de Dropbox, Drive o cualquier ruta local
            </span>
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-password`}>Master password</label>
            <input
              id={`${fieldId}-password`}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Tu contraseña maestra"
              disabled={loading}
              autoFocus
            />
          </div>

          {mode === "create" && (
            <div className="field">
              <label htmlFor={`${fieldId}-confirm`}>Confirmar password</label>
              <input
                id={`${fieldId}-confirm`}
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repetí tu contraseña maestra"
                disabled={loading}
              />
            </div>
          )}

          {displayError && (
            <div className="error-banner">{displayError}</div>
          )}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading
              ? mode === "create"
                ? "Creando vault..."
                : "Desbloqueando..."
              : mode === "create"
              ? "Crear vault"
              : "Desbloquear"}
          </button>
        </form>

        {mode === "create" && (
          <div className="security-note">
            🛡️ Tu master password nunca se almacena. Si la perdés, no hay
            recuperación posible.
          </div>
        )}
      </div>
    </div>
  );
}
