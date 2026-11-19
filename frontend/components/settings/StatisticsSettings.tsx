import React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Qué pasa con lo leído cuando el libro ya no está.
 *
 * Por defecto las estadísticas sobreviven al libro, y esa es la decisión que
 * importa: borrar una novela para hacer sitio no debería borrar las horas que le
 * echaste. Quien prefiera lo contrario lo apaga aquí, y el botón de abajo limpia lo
 * que quedó de libros ya borrados.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function StatisticsSettings({
  lang,
  settings,
  onSaveSettings,
  onClearDeletedBooks,
  showConfirm,
  showToast,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  onClearDeletedBooks: () => Promise<void> | void;
  showConfirm: (options: Record<string, any>) => Promise<boolean>;
  showToast: (message: string, kind?: string) => void;
}) {
  return (
    <>
      <p className="settings-card-desc">
        {lang === 'es'
          ? 'Lo que Yoru apunta de tus lecturas: tiempo, caracteres y rachas.'
          : 'What Yoru records about your reading: time, characters and streaks.'}
      </p>

      <div className="settings-row-control">
        <span className="settings-label-text" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{lang === 'es' ? 'Conservar lo leído al borrar un libro' : 'Keep reading history when a book is deleted'}</span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-dark)', fontWeight: 400 }}>
            {lang === 'es' ? 'Tus horas y rachas no bajan aunque quites la novela.' : 'Your hours and streaks stay even if you remove the novel.'}
          </span>
        </span>
        <label className="migaku-switch">
          <input
            type="checkbox"
            checked={settings.keepStatsOnDelete !== false}
            onChange={(e) => onSaveSettings({ ...settings, keepStatsOnDelete: e.target.checked })}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>

      <div style={{ marginTop: '16px' }}>
        <button
          type="button"
          onClick={async () => {
            const ok = await showConfirm({
              title: lang === 'es' ? '¿Borrar ese historial?' : 'Erase that history?',
              message: lang === 'es' ? 'Se borra lo leído en libros que ya no están en tu biblioteca. Tus horas totales y rachas bajarán. No se puede deshacer.' : 'Reading recorded for books no longer in your library is erased. Your totals and streaks will drop. This cannot be undone.',
              type: 'warning',
              confirmText: lang === 'es' ? 'Limpiar' : 'Clear',
            });
            if (ok) {
              await onClearDeletedBooks();
              showToast(lang === 'es' ? 'Limpieza completada.' : 'Cleanup done.', 'success');
            }
          }}
          className="settings-btn is-quiet"
        >
          <Trash2 size={14} /> <span>{lang === 'es' ? 'Borrar el historial de libros ya eliminados' : 'Erase history of already deleted books'}</span>
        </button>
      </div>
    </>
  );
}
