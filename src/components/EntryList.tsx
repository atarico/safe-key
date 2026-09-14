import { useState } from "react";
import type { Entry } from "../lib/tauri";

interface Props {
  entries: Entry[];
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onCopyPassword: (id: string) => Promise<boolean>;
}

export function EntryList({ entries, onEdit, onDelete, onCopyPassword }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = entries.filter(e =>
    e.site_url.toLowerCase().includes(search.toLowerCase()) ||
    e.username.toLowerCase().includes(search.toLowerCase())
  );

  const handleCopy = async (id: string) => {
    // A rejection means the copy did not happen, same as a false result.
    const ok = await onCopyPassword(id).catch(() => false);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleDelete = (entry: Entry) => {
    if (confirm(`¿Eliminar la entrada de ${entry.site_url}?`)) {
      onDelete(entry);
    }
  };

  return (
    <div className="entry-list">
      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por sitio o usuario..."
          aria-label="Buscar entradas"
        />
        {search && (
          <button
            className="btn-icon"
            onClick={() => setSearch("")}
            aria-label="Limpiar búsqueda"
          >
            ✕
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          {search ? (
            <p>No hay entradas que coincidan con "{search}"</p>
          ) : (
            <>
              <p className="empty-icon">🔐</p>
              <p>Tu vault está vacío</p>
              <p className="empty-hint">Agregá tu primera contraseña con el botón +</p>
            </>
          )}
        </div>
      ) : (
        <ul className="entries">
          {filtered.map(entry => (
            <li key={entry.id} className="entry-item">
              <div className="entry-favicon">
                {entry.site_url.charAt(0).toUpperCase()}
              </div>
              <div className="entry-info">
                <span className="entry-site">{entry.site_url}</span>
                <span className="entry-username">{entry.username}</span>
              </div>
              <div className="entry-actions">
                <button
                  className="btn-icon"
                  onClick={() => handleCopy(entry.id)}
                  title="Copiar contraseña"
                >
                  {copiedId === entry.id ? "✅" : "📋"}
                </button>
                <button
                  className="btn-icon"
                  onClick={() => onEdit(entry)}
                  title="Editar"
                >
                  ✏️
                </button>
                <button
                  className="btn-icon btn-danger"
                  onClick={() => handleDelete(entry)}
                  title="Eliminar"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
