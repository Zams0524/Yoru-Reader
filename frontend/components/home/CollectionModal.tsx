import React from 'react';
import { ArrowLeft, FolderPlus, SlidersHorizontal, X } from 'lucide-react';
import {
  addDynamicCollection,
  addManualCollection,
  collectionNameTaken,
  matchesRule,
  ruleValues,
  type RuleField,
} from '../../utils/collections';
import type { ShelfBook } from './libraryIndex';

/**
 * «Crear colección».
 *
 * Es la puerta que no había: hasta ahora no existía **ninguna** forma de crear una
 * colección en la app. El botón que lo hacía vivía en la barra lateral de la
 * biblioteca antigua, dentro de `{!embedded && …}`, y la concha la embebe siempre.
 *
 * Dos caminos, apilados, con el manual marcado porque es el que casi siempre se
 * quiere: una colección a mano, o una que se llene sola con una regla.
 *
 * No lleva público/privado. Eso exige cuentas y Yoru guarda todo en el dispositivo:
 * sería un interruptor que no hace nada.
 */

type Page = 'choose' | 'manual' | 'dynamic';

const FIELD_LABELS: Record<RuleField, { es: string; en: string }> = {
  author: { es: 'Autor', en: 'Author' },
  series: { es: 'Serie', en: 'Series' },
  status: { es: 'Estado', en: 'Status' },
  tag: { es: 'Etiqueta', en: 'Tag' },
};

const STATUS_LABELS: Record<string, { es: string; en: string }> = {
  unread: { es: 'Sin empezar', en: 'Not started' },
  reading: { es: 'Leyendo', en: 'Reading' },
  completed: { es: 'Leído', en: 'Finished' },
  paused: { es: 'En pausa', en: 'Paused' },
  planning: { es: 'Pendiente', en: 'Planned' },
};

function valueLabel(field: RuleField, value: string, es: boolean): string {
  if (field !== 'status') return value;
  const label = STATUS_LABELS[value];
  return label ? (es ? label.es : label.en) : value;
}

export default function CollectionModal({
  books,
  es,
  onClose,
  onCreated,
}: {
  books: ShelfBook[];
  es: boolean;
  onClose: () => void;
  /** Avisa de que hay una colección nueva, para ir a verla. */
  onCreated: (name: string) => void;
}) {
  const [page, setPage] = React.useState<Page>('choose');
  const [name, setName] = React.useState('');
  const [field, setField] = React.useState<RuleField>('author');
  const [value, setValue] = React.useState('');

  const existingTags = React.useMemo(() => {
    const tags = new Set<string>();
    for (const book of books) for (const tag of book.tags || []) tags.add(tag);
    return [...tags];
  }, [books]);

  const values = React.useMemo(() => ruleValues(books, field), [books, field]);

  // Cambiar de campo deja el valor anterior sin sentido: se coge el primero del nuevo.
  React.useEffect(() => { setValue(values[0] || ''); }, [values]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = name.trim();
  const taken = Boolean(trimmed) && collectionNameTaken(trimmed, existingTags);
  const matched = React.useMemo(
    () => (page === 'dynamic' && value ? books.filter((book) => matchesRule(book, { field, value })).length : 0),
    [page, books, field, value]
  );

  const create = () => {
    if (!trimmed || taken) return;
    if (page === 'manual') addManualCollection(trimmed);
    else if (value) addDynamicCollection({ name: trimmed, rule: { field, value } });
    else return;
    onCreated(trimmed);
    onClose();
  };

  return (
    <div
      className="yoru-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={es ? 'Crear colección' : 'Create collection'}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="yoru-modal">
        <div className="yoru-modal-head">
          <div style={{ minWidth: 0 }}>
            {page !== 'choose' && (
              <button type="button" className="yoru-modal-back" onClick={() => setPage('choose')}>
                <ArrowLeft size={14} />
                {es ? 'Atrás' : 'Back'}
              </button>
            )}
            <h2 className="yoru-modal-title">{es ? 'Crear colección' : 'Create collection'}</h2>
            <p className="yoru-modal-sub">
              {page === 'choose'
                ? es
                  ? 'Crea una colección manual o una que se llene sola con una regla.'
                  : 'Create a manual collection, or one that fills itself from a rule.'
                : page === 'manual'
                  ? es
                    ? 'Tú eliges qué libros entran, uno a uno.'
                    : 'You choose which books go in, one by one.'
                  : es
                    ? 'Entra solo lo que cumpla la regla, también los libros que añadas después.'
                    : 'Only what matches the rule goes in, including books you add later.'}
            </p>
          </div>
          <button type="button" className="yoru-modal-close" onClick={onClose} aria-label={es ? 'Cerrar' : 'Close'}>
            <X size={18} />
          </button>
        </div>

        {page === 'choose' ? (
          <div className="yoru-modal-choices">
            <button type="button" className="yoru-choice is-marked" onClick={() => setPage('manual')}>
              <FolderPlus size={18} />
              <span>{es ? 'Crear colección manual' : 'Create manual collection'}</span>
            </button>
            <button type="button" className="yoru-choice" onClick={() => setPage('dynamic')}>
              <SlidersHorizontal size={18} />
              <span>{es ? 'Crear colección dinámica' : 'Create dynamic collection'}</span>
            </button>
          </div>
        ) : (
          <div className="yoru-modal-body">
            <label className="yoru-field">
              <span className="yoru-field-label">{es ? 'Nombre' : 'Name'}</span>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
                placeholder={es ? 'Por ejemplo, Para el verano' : 'For example, Summer reads'}
              />
            </label>
            {taken && (
              <p className="yoru-field-note" role="alert">
                {es ? 'Ya tienes una colección con ese nombre.' : 'You already have a collection with that name.'}
              </p>
            )}

            {page === 'dynamic' && (
              <>
                <div className="yoru-rule-row">
                  <label className="yoru-field">
                    <span className="yoru-field-label">{es ? 'Entra si' : 'Include when'}</span>
                    <select value={field} onChange={(event) => setField(event.target.value as RuleField)}>
                      {(Object.keys(FIELD_LABELS) as RuleField[]).map((entry) => (
                        <option key={entry} value={entry}>
                          {es ? FIELD_LABELS[entry].es : FIELD_LABELS[entry].en}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="yoru-field">
                    <span className="yoru-field-label">{es ? 'es' : 'is'}</span>
                    <select value={value} onChange={(event) => setValue(event.target.value)} disabled={!values.length}>
                      {values.map((entry) => (
                        <option key={entry} value={entry}>{valueLabel(field, entry, es)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="yoru-field-note">
                  {values.length === 0
                    ? es
                      ? 'Ninguno de tus libros tiene ese dato todavía.'
                      : 'None of your books has that yet.'
                    : es
                      ? `Ahora mismo entrarían ${matched} ${matched === 1 ? 'libro' : 'libros'}.`
                      : `Right now ${matched} ${matched === 1 ? 'book' : 'books'} would go in.`}
                </p>
              </>
            )}

            <div className="yoru-modal-actions">
              <button type="button" className="yoru-btn" onClick={onClose}>
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                className="yoru-btn yoru-btn-primary"
                onClick={create}
                disabled={!trimmed || taken || (page === 'dynamic' && !value)}
              >
                {es ? 'Crear' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
