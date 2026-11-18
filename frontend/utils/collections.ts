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
export type RuleField =
  | 'author'
  | 'series'
  | 'status'
  | 'tag'
  | 'percent'
  | 'chars'
  | 'chapters'
  | 'added'
  | 'lastRead';

/**
 * Lo que la regla hace con el valor.
 *
 * Con un solo operador —«el autor **es** X»— una colección dinámica solo sabe recoger
 * lo que ya estaba clasificado. Lo que hace falta para una lista de lectura son las
 * comparaciones: «menos del 20 % leído», «añadido después de marzo», «más de diez
 * capítulos». De ahí los seis.
 */
export type RuleOp = 'is' | 'isNot' | 'contains' | 'gte' | 'lte' | 'before' | 'after';

export interface CollectionRule {
  field: RuleField;
  value: string;
  /** Sin operador se entiende `is`, que es lo que valía cuando solo había uno. */
  op?: RuleOp;
}

export interface DynamicCollection {
  name: string;
  /**
   * La primera regla, suelta.
   *
   * Se sigue escribiendo —y leyendo— para que las colecciones guardadas antes de que
   * hubiera varias reglas funcionen sin migrar nada, y para que una versión de Yoru
   * que vaya por detrás entienda al menos la primera.
   */
  rule: CollectionRule;
  /** Todas las reglas, la primera incluida. Si falta, la colección es de una sola. */
  rules?: CollectionRule[];
  /** `all`: se cumplen todas. `any`: basta una. Por omisión, `all`. */
  match?: 'all' | 'any';
}

/** Los operadores que tienen sentido en cada campo, en el orden en que se ofrecen. */
export function opsForField(field: RuleField): RuleOp[] {
  if (field === 'author' || field === 'series' || field === 'tag') return ['is', 'isNot', 'contains'];
  if (field === 'status') return ['is', 'isNot'];
  if (field === 'added' || field === 'lastRead') return ['after', 'before'];
  return ['gte', 'lte'];
}

/** Si el campo se compara con un número escrito a mano en vez de con una lista. */
export function isNumberField(field: RuleField): boolean {
  return field === 'percent' || field === 'chars' || field === 'chapters';
}

/** Si el campo se compara con una fecha. */
export function isDateField(field: RuleField): boolean {
  return field === 'added' || field === 'lastRead';
}

/** Las reglas de una colección, venga de donde venga lo guardado. */
export function rulesOf(collection: DynamicCollection): CollectionRule[] {
  if (Array.isArray(collection.rules) && collection.rules.length > 0) return collection.rules;
  return [collection.rule];
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

const FIELDS: string[] = ['author', 'series', 'status', 'tag', 'percent', 'chars', 'chapters', 'added', 'lastRead'];
const OPS: string[] = ['is', 'isNot', 'contains', 'gte', 'lte', 'before', 'after'];

function isRule(entry: unknown): entry is CollectionRule {
  const candidate = entry as CollectionRule;
  return Boolean(
    candidate
      && typeof candidate.value === 'string'
      && FIELDS.includes(candidate.field)
      && (candidate.op === undefined || OPS.includes(candidate.op))
  );
}

function isDynamic(entry: unknown): entry is DynamicCollection {
  const candidate = entry as DynamicCollection;
  if (!candidate || typeof candidate.name !== 'string' || !isRule(candidate.rule)) return false;
  /*
    Una regla rota tira la colección entera y no solo esa regla: callarse una condición
    cambiaría lo que la colección significa —«sin empezar **y** de este autor» pasaría a
    ser «sin empezar»— y llenaría la lista de libros que el usuario no pidió.
  */
  if (candidate.rules !== undefined && (!Array.isArray(candidate.rules) || !candidate.rules.every(isRule))) return false;
  if (candidate.match !== undefined && candidate.match !== 'all' && candidate.match !== 'any') return false;
  return true;
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
  /*
    La primera regla se copia en `rule` al guardar, no al leer: así lo guardado tiene
    siempre las dos formas al día y nadie tiene que acordarse de cuál manda.
  */
  const reglas = rulesOf(collection);
  write({
    ...data,
    dynamic: [
      ...data.dynamic.filter((entry) => entry.name.toLowerCase() !== trimmed.toLowerCase()),
      { ...collection, name: trimmed, rule: reglas[0], rules: reglas },
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
  createdAt?: string;
  lastRead?: string;
  chapters?: unknown[];
  progress?: { percent?: number; charactersRead?: number };
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

/** El valor numérico del libro para un campo de número. */
function numberOf(book: RuleBook, field: RuleField): number {
  if (field === 'percent') return book.progress?.percent ?? 0;
  if (field === 'chars') return book.progress?.charactersRead ?? 0;
  return Array.isArray(book.chapters) ? book.chapters.length : 0;
}

/** El día del libro para un campo de fecha, en milisegundos, o null si no lo tiene. */
function dateOf(book: RuleBook, field: RuleField): number | null {
  const raw = field === 'added' ? book.createdAt : book.lastRead;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Los textos del libro que un campo de texto compara. Un libro puede tener varios. */
function textsOf(book: RuleBook, field: RuleField): string[] {
  if (field === 'author') return book.author ? [book.author] : [];
  if (field === 'series') return book.series ? [book.series] : [];
  if (field === 'tag') return book.tags || [];
  return [statusOf(book)];
}

/** Si un libro entra en la regla. */
export function matchesRule(book: RuleBook, rule: CollectionRule): boolean {
  const op: RuleOp = rule.op || 'is';

  if (isNumberField(rule.field)) {
    const limite = Number(rule.value);
    // Un número sin escribir no filtra nada: la regla a medias no deja fuera a nadie.
    if (!Number.isFinite(limite)) return true;
    const valor = numberOf(book, rule.field);
    return op === 'lte' ? valor <= limite : valor >= limite;
  }

  if (isDateField(rule.field)) {
    const limite = Date.parse(rule.value);
    if (!Number.isFinite(limite)) return true;
    const valor = dateOf(book, rule.field);
    /*
      Sin fecha el libro queda fuera, con cualquiera de los dos operadores. Un libro que
      no se ha leído nunca no se leyó «antes de marzo»: no se leyó.
    */
    if (valor === null) return false;
    return op === 'before' ? valor <= limite : valor >= limite;
  }

  const textos = textsOf(book, rule.field);
  const needle = rule.value.trim().toLowerCase();
  if (!needle) return true;
  if (op === 'contains') return textos.some((texto) => texto.toLowerCase().includes(needle));
  const igual = textos.some((texto) => texto === rule.value);
  return op === 'isNot' ? !igual : igual;
}

/**
 * Si un libro entra en la colección, con todas sus reglas.
 *
 * Sin ninguna regla no entra nadie, y no todo el mundo: una colección vacía de reglas
 * es un formulario a medio hacer, y enseñar la biblioteca entera como si fuera una
 * colección del usuario es peor que enseñarla vacía.
 */
export function matchesCollection(book: RuleBook, collection: DynamicCollection): boolean {
  const reglas = rulesOf(collection).filter(Boolean);
  if (reglas.length === 0) return false;
  if (collection.match === 'any') return reglas.some((rule) => matchesRule(book, rule));
  return reglas.every((rule) => matchesRule(book, rule));
}
