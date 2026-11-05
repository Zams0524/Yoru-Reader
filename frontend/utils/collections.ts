import { db } from './db';

/**
 * Colecciones del usuario.
 *
 * Hay dos clases, y se guardan en sitios distintos a propósito:
 *
 * - **Manual**: es una etiqueta en los libros (`book.tags`). Ya funcionaba así desde
 *   siempre, así que las que el usuario tenga siguen donde estaban y no hay que migrar
 *   nada. Una colección manual vacía no tendría dónde vivir, de ahí la lista de nombres
 *   de aquí: para que una recién creada exista antes de meterle el primer libro.
 * - **Dinámica**: no se guarda libro a libro, sino la regla. Se recalcula al mirarla,
 *   así que un libro nuevo entra solo si cumple.
 *
 * Lo que **no** hay es público/privado: eso exige cuentas, y Yoru guarda todo en el
 * dispositivo. Sería un interruptor muerto.
 */

const BASE_KEY = 'yoru_collections';

/**
 * Los campos por los que se puede filtrar.
 *
 * Son los que existen de verdad en un libro de Yoru. Quedan fuera dos que se habían
 * pedido: **idioma**, porque `Book` no tiene ese campo (en Yoru todo es japonés, y el
 * distintivo «JA» de la ficha está escrito a mano), y **servidor**, porque un libro
 * traído de Kavita no se distingue de uno arrastrado a la ventana: no se guarda de
 * dónde vino. Ofrecerlos sería poner dos desplegables que no pueden filtrar nada.
 */
export type RuleField = 'author' | 'series' | 'status' | 'tag';

export interface CollectionRule {
  field: RuleField;
  value: string;
}

export interface DynamicCollection {
  name: string;
  rule: CollectionRule;
}

interface Stored {
  /** Colecciones manuales, por nombre. Pueden estar vacías de libros. */
  manual: string[];
  dynamic: DynamicCollection[];
}

const EMPTY: Stored = { manual: [], dynamic: [] };

function key(): string {
  return `${BASE_KEY}_${db.getActiveProfileId() || 'profile-default'}`;
}

function isDynamic(entry: unknown): entry is DynamicCollection {
  const candidate = entry as DynamicCollection;
  return Boolean(
    candidate
      && typeof candidate.name === 'string'
      && candidate.rule
      && typeof candidate.rule.value === 'string'
      && ['author', 'series', 'status', 'tag'].includes(candidate.rule.field)
  );
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      manual: Array.isArray(parsed?.manual) ? parsed.manual.filter((n: unknown) => typeof n === 'string') : [],
      dynamic: Array.isArray(parsed?.dynamic) ? parsed.dynamic.filter(isDynamic) : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(data: Stored): void {
  try {
    localStorage.setItem(key(), JSON.stringify(data));
    window.dispatchEvent(new Event('yoru-collections-updated'));
  } catch {
    // Sin sitio donde guardar no se pierde lo que ya hay: las manuales viven en las
    // etiquetas de los libros, que van por su cuenta.
  }
}

export function getManualCollections(): string[] {
  return read().manual;
}

export function getDynamicCollections(): DynamicCollection[] {
  return read().dynamic;
}

/** Un nombre ya usado, de cualquier clase. Dos colecciones iguales serían una trampa. */
export function collectionNameTaken(name: string, existingTags: string[] = []): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return true;
  const data = read();
  return [...data.manual, ...data.dynamic.map((entry) => entry.name), ...existingTags]
    .some((entry) => entry.trim().toLowerCase() === needle);
}

export function addManualCollection(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const data = read();
  if (data.manual.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return;
  write({ ...data, manual: [...data.manual, trimmed] });
}

export function addDynamicCollection(collection: DynamicCollection): void {
  const trimmed = collection.name.trim();
  if (!trimmed) return;
  const data = read();
  write({
    ...data,
    dynamic: [
      ...data.dynamic.filter((entry) => entry.name.toLowerCase() !== trimmed.toLowerCase()),
      { ...collection, name: trimmed },
    ],
  });
}

export function removeCollection(name: string): void {
  const needle = name.trim().toLowerCase();
  const data = read();
  write({
    manual: data.manual.filter((entry) => entry.toLowerCase() !== needle),
    dynamic: data.dynamic.filter((entry) => entry.name.toLowerCase() !== needle),
  });
}

/** Lo mínimo de un libro que hace falta para decidir una regla. */
interface RuleBook {
  author?: string;
  series?: string;
  tags?: string[];
  status?: string;
  progress?: { percent?: number };
}

function statusOf(book: RuleBook): string {
  const percent = book.progress?.percent ?? 0;
  return book.status || (percent === 0 ? 'unread' : percent >= 100 ? 'completed' : 'reading');
}

/** Los valores que una regla puede tomar, sacados de la biblioteca de verdad. */
export function ruleValues(books: RuleBook[], field: RuleField): string[] {
  const values = new Set<string>();
  for (const book of books) {
    if (field === 'author' && book.author) values.add(book.author);
    if (field === 'series' && book.series) values.add(book.series);
    if (field === 'tag') for (const tag of book.tags || []) values.add(tag);
    if (field === 'status') values.add(statusOf(book));
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'ja'));
}

/** Si un libro entra en la regla. */
export function matchesRule(book: RuleBook, rule: CollectionRule): boolean {
  if (rule.field === 'author') return book.author === rule.value;
  if (rule.field === 'series') return book.series === rule.value;
  if (rule.field === 'tag') return (book.tags || []).includes(rule.value);
  return statusOf(book) === rule.value;
}
