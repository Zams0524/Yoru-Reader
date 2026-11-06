import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Borrarlo todo.
 *
 * Vive sola al final de Ajustes y se pinta en rojo porque es lo único de esta
 * pantalla que no tiene vuelta atrás. La confirmación la pide `Library`, que es
 * quien sabe qué se va a borrar.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function DangerZoneSettings({
  lang,
  onDeleteAllData,
}: {
  lang: string;
  onDeleteAllData: () => void;
}) {
  return (
    <>
      <p className="settings-card-desc">
        {lang === 'es'
          ? 'Acciones destructivas e irreversibles sobre los datos almacenados en la aplicación.'
          : 'Irreversible destructive actions on stored application data.'}
      </p>

      <div style={{ marginTop: '16px' }}>
        <button
          type="button"
          className="reset-filter-btn"
          onClick={onDeleteAllData}
          style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <AlertTriangle size={14} /> <span>{lang === 'es' ? 'Eliminar todos los datos' : 'Delete all data'}</span>
        </button>
      </div>
    </>
  );
}
