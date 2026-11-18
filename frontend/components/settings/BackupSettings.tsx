import React from 'react';
import { Download, Upload } from 'lucide-react';

/**
 * Guardar la biblioteca entera en un fichero, y traerla de vuelta.
 *
 * Los diccionarios se quedan fuera a propósito: pesan más que todo lo demás junto
 * y se vuelven a instalar solos. Lo que no se puede recuperar —los libros, lo
 * leído, los perfiles, los ajustes de Anki— es lo que va dentro.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function BackupSettings({
  lang,
  onExport,
  onImport,
}: {
  lang: string;
  onExport: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <p className="settings-card-desc">
        {lang === 'es'
          ? 'Guarda todo tu catálogo, historial de lectura, perfiles y configuraciones de Anki en un archivo local (se excluyen los diccionarios para mantener el archivo ligero).'
          : 'Export all your library books, reading statistics, profiles, and configurations to a local backup file.'}
      </p>

      <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
        <button
          type="button"
          className="reset-filter-btn"
          onClick={onExport}
          style={{ background: 'var(--yoru-gold-soft)', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <Download size={16} /> {lang === 'es' ? 'Exportar Biblioteca' : 'Export Library'}
        </button>

        <label className="reset-filter-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <Upload size={16} /> {lang === 'es' ? 'Importar Respaldo' : 'Import Backup'}
          <input
            type="file"
            accept=".json,.zip"
            onChange={onImport}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    </>
  );
}
