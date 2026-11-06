import React from 'react';
import { Database } from 'lucide-react';

/**
 * La puerta al panel de vocabulario.
 *
 * Aquí no se gestiona nada: lo que hace es abrir el panel, que es donde de verdad
 * se importa de Anki o de JPDB y se exporta. La tarjeta existe para que quien
 * busque «anki» o «vocabulario» en Ajustes encuentre el camino.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function VocabularySettings({
  lang,
  isPhone,
  onOpenPanel,
}: {
  lang: string;
  /** En teléfono la descripción es más corta: no caben las tres vías. */
  isPhone: boolean;
  onOpenPanel: () => void;
}) {
  return (
    <>
      <p className="settings-card-desc">
        {isPhone
          ? (lang === 'es'
            ? 'Importa, exporta y gestiona tus palabras. Importa mazos de Anki (.apkg), JPDB, listas de palabras o listas de frecuencia.'
            : 'Import, export and manage your words. Import Anki decks (.apkg), JPDB, word lists or frequency lists.')
          : (lang === 'es'
            ? 'Importa, exporta y gestiona tu base de datos de palabras conocidas y en estudio. Sincroniza desde AnkiConnect, JPDB, archivos de texto o listas de frecuencia.'
            : 'Import, export, and manage your known and learning word database. Sync from AnkiConnect, JPDB, text files, or frequency lists.')}
      </p>
      <button
        type="button"
        className="reset-filter-btn"
        onClick={onOpenPanel}
        style={{ background: 'var(--yoru-gold-soft)', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}
      >
        <Database size={15} /> {lang === 'es' ? 'Abrir Panel de Vocabulario' : 'Open Vocabulary Panel'}
      </button>
    </>
  );
}
