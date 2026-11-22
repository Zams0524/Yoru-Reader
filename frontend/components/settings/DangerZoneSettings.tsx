import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Borrar el progreso de lectura, o borrarlo todo.
 *
 * El primero deja la biblioteca como recién importada (sin posición, sin estadísticas y
 * sin lo leído del servidor) pero conserva los libros, las palabras y las tarjetas; el
 * segundo no deja nada.
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
  onResetReadingProgress,
}: {
  lang: string;
  onDeleteAllData: () => void;
  onResetReadingProgress: () => void;
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
          onClick={onResetReadingProgress}
          style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <RotateCcw size={14} /> <span>{lang === 'es' ? 'Borrar mi progreso de lectura' : 'Erase my reading progress'}</span>
        </button>
        <p className="settings-card-desc" style={{ marginTop: '8px' }}>
          {lang === 'es'
            ? 'Pone a cero por dónde vas en cada libro, tus estadísticas y rachas, y lo leído o escuchado del servidor, en todos tus aparatos. Conserva tus libros, marcadores, notas, palabras y tarjetas.'
            : 'Resets your place in every book, your statistics and streaks, and what you read or listened to from the server, on all your devices. Keeps your books, bookmarks, notes, words and cards.'}
        </p>
      </div>

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
