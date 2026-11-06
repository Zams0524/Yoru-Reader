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
          ? 'Configura el almacenamiento del historial de lectura y las acciones de limpieza.'
          : 'Configure the storage of reading history and cleanup actions.'}
      </p>

      <div className="settings-row-control">
        <span className="settings-label-text">
          {lang === 'es' ? 'Conservar estadísticas al eliminar libro' : 'Keep stats on book deletion'}
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
              title: lang === 'es' ? '¿Limpiar estadísticas?' : 'Clear statistics?',
              message: lang === 'es' ? '¿Limpiar estadísticas de libros ya eliminados?' : 'Clear stats for already deleted books?',
              type: 'warning',
              confirmText: lang === 'es' ? 'Limpiar' : 'Clear',
            });
            if (ok) {
              await onClearDeletedBooks();
              showToast(lang === 'es' ? 'Limpieza completada.' : 'Cleanup done.', 'success');
            }
          }}
          style={{ width: '100%', padding: '8px 10px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <Trash2 size={14} /> <span>{lang === 'es' ? 'Estadísticas de libros eliminados' : 'Deleted-book statistics'}</span>
        </button>
      </div>
    </>
  );
}
