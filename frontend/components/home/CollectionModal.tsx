import React from 'react';
import { ArrowLeft, FolderPlus, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  addDynamicCollection,
  addManualCollection,
  collectionNameTaken,
  isDateField,
  isNumberField,
  matchesCollection,
  opsForField,
  ruleValues,
  rulesOf,
  type CollectionRule,
  type DynamicCollection,
  type RuleField,
  type RuleOp,
} from '../../utils/collections';
import type { ShelfBook } from './libraryIndex';

/**
 * «Crear colección», y también editar las reglas de una dinámica.
 *
 * Es la puerta que no había: hasta que existió esta ventana no había **ninguna** forma
 * de crear una colección en la app. El botón que lo hacía vivía en la barra lateral de
 * la biblioteca antigua, dentro de `{!embedded && …}`, y la concha la embebe siempre.
 *
 * Dos caminos, apilados, con el manual marcado porque es el que casi siempre se
 * quiere: una colección a mano, o una que se llene sola con unas reglas.
 *
 * Las reglas son varias, con operadores, y con un «se cumplen todas / basta una»: con
 * una sola igualdad —«el autor es X»— una colección dinámica no pasaba de recoger lo
 * que ya estaba clasificado, y lo que se quiere pedir es «sin empezar, de menos de
 * diez capítulos y añadido este año».
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
  percent: { es: 'Porcentaje leído', en: 'Percent read' },
  chars: { es: 'Caracteres leídos', en: 'Characters read' },
  chapters: { es: 'Capítulos', en: 'Chapters' },
  added: { es: 'Añadido', en: 'Added' },
  lastRead: { es: 'Última lectura', en: 'Last read' },
};

const OP_LABELS: Record<RuleOp, { es: string; en: string }> = {
  is: { es: 'es', en: 'is' },
  isNot: { es: 'no es', en: 'is not' },
  contains: { es: 'contiene', en: 'contains' },
  gte: { es: 'como mínimo', en: 'at least' },
  lte: { es: 'como máximo', en: 'at most' },
  before: { es: 'antes del', en: 'before' },
  after: { es: 'desde el', en: 'from' },
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

/** Si la regla está rellenada lo bastante para filtrar algo. */
function ruleReady(rule: CollectionRule): boolean {
  if (isNumberField(rule.field)) return rule.value.trim() !== '' && Number.isFinite(Number(rule.value));
  if (isDateField(rule.field)) return Number.isFinite(Date.parse(rule.value));
  return rule.value.trim() !== '';
}

export default function CollectionModal({
  books,
  es,
  onClose,
  onCreated,
  editing,
}: {
  books: ShelfBook[];
  es: boolean;
  onClose: () => void;
  /** Avisa de que hay una colección nueva (o recién cambiada), para ir a verla. */
  onCreated: (name: string) => void;
  /** Si se abre para cambiar las reglas de una dinámica que ya existe. */
  editing?: DynamicCollection;
}) {
  const [page, setPage] = React.useState<Page>(editing ? 'dynamic' : 'choose');
  const [name, setName] = React.useState(editing?.name || '');
  const [match, setMatch] = React.useState<'all' | 'any'>(editing?.match === 'any' ? 'any' : 'all');
  const [rules, setRules] = React.useState<CollectionRule[]>(() =>
    editing
      ? rulesOf(editing).map((rule) => ({ ...rule, op: rule.op || 'is' }))
      : [{ field: 'author', value: '', op: 'is' }]
  );

  const existingTags = React.useMemo(() => {
    const tags = new Set<string>();
    for (const book of books) for (const tag of book.tags || []) tags.add(tag);
    return [...tags];
  }, [books]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = name.trim();
  /*
    Editando, su propio nombre no está «cogido»: lo tiene ella. Se compara en minúsculas
    porque `collectionNameTaken` también ignora las mayúsculas.
  */
  const taken = Boolean(trimmed)
    && trimmed.toLowerCase() !== (editing?.name || '').toLowerCase()
    && collectionNameTaken(trimmed, existingTags);

  const listas = React.useMemo(() => rules.filter(ruleReady), [rules]);
  const borrador: DynamicCollection = React.useMemo(
    () => ({ name: trimmed || '—', rule: listas[0] || rules[0], rules: listas, match }),
    [trimmed, listas, rules, match]
  );
  const vistaPrevia = React.useMemo(
    () => (page === 'dynamic' && listas.length > 0 ? books.filter((book) => matchesCollection(book, borrador)) : []),
    [page, books, borrador, listas.length]
  );

  const cambiarCampo = (index: number, field: RuleField) => {
    setRules((previo) => previo.map((rule, i) => {
      if (i !== index) return rule;
      // Cambiar de campo deja el valor y el operador anteriores sin sentido: se reinician.
      const op = opsForField(field)[0];
      const value = isNumberField(field) || isDateField(field) ? '' : (ruleValues(books, field)[0] || '');
      return { field, op, value };
    }));
  };

  const cambiarRegla = (index: number, cambio: Partial<CollectionRule>) => {
    setRules((previo) => previo.map((rule, i) => (i === index ? { ...rule, ...cambio } : rule)));
  };

  const create = () => {
    if (!trimmed || taken) return;
    if (page === 'manual') addManualCollection(trimmed);
    else if (listas.length > 0) addDynamicCollection({ name: trimmed, rule: listas[0], rules: listas, match });
    else return;
    onCreated(trimmed);
    onClose();
  };

  const titulo = editing
    ? (es ? 'Editar reglas' : 'Edit rules')
    : (es ? 'Crear colección' : 'Create collection');

  return (
    <div
      className="yoru-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="yoru-modal">
        <div className="yoru-modal-head">
          <div style={{ minWidth: 0 }}>
            {page !== 'choose' && !editing && (
              <button type="button" className="yoru-modal-back" onClick={() => setPage('choose')}>
                <ArrowLeft size={14} />
                {es ? 'Atrás' : 'Back'}
              </button>
            )}
            <h2 className="yoru-modal-title">{titulo}</h2>
            <p className="yoru-modal-sub">
              {page === 'choose'
                ? es
                  ? 'Crea una colección manual o una que se llene sola con unas reglas.'
                  : 'Create a manual collection, or one that fills itself from rules.'
                : page === 'manual'
                  ? es
                    ? 'Tú eliges qué libros entran, uno a uno.'
                    : 'You choose which books go in, one by one.'
                  : es
                    ? 'Entra solo lo que cumpla las reglas, también los libros que añadas después.'
                    : 'Only what matches the rules goes in, including books you add later.'}
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
                {rules.length > 1 && (
                  <div
                    className="yoru-rule-match"
                    role="radiogroup"
                    aria-label={es ? 'Cómo se combinan las reglas' : 'How rules combine'}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={match === 'all'}
                      className={match === 'all' ? 'is-active' : ''}
                      onClick={() => setMatch('all')}
                    >
                      {es ? 'Se cumplen todas' : 'All conditions'}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={match === 'any'}
                      className={match === 'any' ? 'is-active' : ''}
                      onClick={() => setMatch('any')}
                    >
                      {es ? 'Basta una' : 'Any condition'}
                    </button>
                  </div>
                )}

                {rules.map((rule, index) => {
                  const ops = opsForField(rule.field);
                  const values = ruleValues(books, rule.field);
                  const libre = rule.op === 'contains';
                  return (
                    <div className="yoru-rule-row" key={index}>
                      <label className="yoru-field">
                        <span className="yoru-field-label">
                          {index === 0
                            ? (es ? 'Entra si' : 'Include when')
                            : match === 'any'
                              ? (es ? 'o si' : 'or when')
                              : (es ? 'y si' : 'and when')}
                        </span>
                        <select
                          value={rule.field}
                          onChange={(event) => cambiarCampo(index, event.target.value as RuleField)}
                        >
                          {(Object.keys(FIELD_LABELS) as RuleField[]).map((entry) => (
                            <option key={entry} value={entry}>
                              {es ? FIELD_LABELS[entry].es : FIELD_LABELS[entry].en}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="yoru-field">
                        <span className="yoru-field-label">{es ? 'condición' : 'condition'}</span>
                        <select
                          value={rule.op || ops[0]}
                          onChange={(event) => cambiarRegla(index, { op: event.target.value as RuleOp })}
                        >
                          {ops.map((entry) => (
                            <option key={entry} value={entry}>
                              {es ? OP_LABELS[entry].es : OP_LABELS[entry].en}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="yoru-field">
                        <span className="yoru-field-label">{es ? 'valor' : 'value'}</span>
                        {isNumberField(rule.field) ? (
                          <input
                            type="number"
                            min={0}
                            max={rule.field === 'percent' ? 100 : undefined}
                            value={rule.value}
                            onChange={(event) => cambiarRegla(index, { value: event.target.value })}
                            placeholder={rule.field === 'percent' ? '20' : '10'}
                          />
                        ) : isDateField(rule.field) ? (
                          <input
                            type="date"
                            value={rule.value}
                            onChange={(event) => cambiarRegla(index, { value: event.target.value })}
                          />
                        ) : libre || values.length === 0 ? (
                          /*
                            Con «contiene» se escribe un trozo de texto, que es justo lo que
                            una lista de valores exactos no puede ofrecer. Y sin valores
                            —ningún libro tiene ese dato todavía— se deja escribir igual: la
                            regla puede ir por delante de la biblioteca.
                          */
                          <input
                            type="text"
                            value={rule.value}
                            onChange={(event) => cambiarRegla(index, { value: event.target.value })}
                            placeholder={es ? 'Escribe un texto' : 'Type some text'}
                          />
                        ) : (
                          <select
                            value={rule.value}
                            onChange={(event) => cambiarRegla(index, { value: event.target.value })}
                          >
                            <option value="">{es ? 'Elige…' : 'Choose…'}</option>
                            {values.map((entry) => (
                              <option key={entry} value={entry}>{valueLabel(rule.field, entry, es)}</option>
                            ))}
                          </select>
                        )}
                      </label>

                      {rules.length > 1 && (
                        <button
                          type="button"
                          className="yoru-rule-remove"
                          onClick={() => setRules((previo) => previo.filter((_, i) => i !== index))}
                          aria-label={es ? 'Quitar esta regla' : 'Remove this rule'}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="yoru-rule-add"
                  onClick={() => setRules((previo) => [...previo, { field: 'status', op: 'is', value: '' }])}
                >
                  <Plus size={14} />
                  {es ? 'Añadir regla' : 'Add rule'}
                </button>

                {/*
                  La vista previa cuenta y además nombra: un «entrarían 14 libros» no deja
                  ver que la regla cogió los que no eran. Con cuatro títulos se nota.
                */}
                <p className="yoru-field-note">
                  {listas.length === 0
                    ? es
                      ? 'Rellena una regla para ver qué entraría.'
                      : 'Fill in a rule to see what would go in.'
                    : es
                      ? `Ahora mismo entrarían ${vistaPrevia.length} ${vistaPrevia.length === 1 ? 'libro' : 'libros'}.`
                      : `Right now ${vistaPrevia.length} ${vistaPrevia.length === 1 ? 'book' : 'books'} would go in.`}
                </p>
                {vistaPrevia.length > 0 && (
                  <ul className="yoru-rule-preview">
                    {vistaPrevia.slice(0, 4).map((book) => (
                      <li key={book.id}>{book.title}</li>
                    ))}
                    {vistaPrevia.length > 4 && (
                      <li className="is-more">
                        {es ? `y ${vistaPrevia.length - 4} más` : `and ${vistaPrevia.length - 4} more`}
                      </li>
                    )}
                  </ul>
                )}
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
                disabled={!trimmed || taken || (page === 'dynamic' && listas.length === 0)}
              >
                {editing ? (es ? 'Guardar' : 'Save') : (es ? 'Crear' : 'Create')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
