import { searchYomitanDB } from './yomitanDB';
import { modoAnalizador } from './parserSettingsStore';
import { idiomaDeDiccionario, idiomaDeLaApp, type IdiomaDefiniciones } from './ordenDiccionarios';

// Japanese-English Dictionary Utility

export interface DictionaryEntry {
  word: string;
  reading: string;
  partsOfSpeech: string[];
  definitions: (string | DictionaryDefinition)[];
  isFromYomitan?: boolean;
  isFromJisho?: boolean;
  isFallback?: boolean;
  /** Con `isFallback`: no se pudo preguntar fuera, en vez de haber preguntado y no estar. */
  sinConexion?: boolean;
  /** Con `isFallback`: dónde se buscó, para no decir que algo no está donde no se miró. */
  fuente?: FuenteDefiniciones;
  frequencies?: any[];
  pitches?: any[];
  /**
   * Las definiciones están en otro idioma que el de la app, y cuál. Solo pasa cuando ningún
   * diccionario en el idioma de la app tiene la palabra: es el respaldo, y la tarjeta lo dice.
   */
  otroIdioma?: IdiomaDefiniciones;
}

export interface DictionaryDefinition {
  dictionary?: string;
  glossary: string;
  partsOfSpeech?: string[];
}

/**
 * De dónde salen las definiciones.
 *
 * - `locales`: solo los diccionarios instalados. No sale nada a internet.
 * - `jiten`: solo Jiten. Siempre por la red, con lo que Jiten tenga.
 * - `ambos`: los locales mandan y Jiten cubre lo que falte. Es lo de siempre.
 */
export type FuenteDefiniciones = 'locales' | 'jiten' | 'ambos';

export const FUENTE_POR_DEFECTO: FuenteDefiniciones = 'ambos';

/*
  Por qué `ambos` por defecto.

  Los diccionarios locales contestan en medio milisegundo y Jiten en unos cien: hay
  doscientas cincuenta veces de diferencia. Preguntar primero en casa y salir solo
  cuando falta es lo que hace que leer no se note lento. `jiten` está para quien lo
  prefiera, pero conviene saber lo que cuesta.
*/
function leerFuente(): FuenteDefiniciones {
  try {
    const perfil = localStorage.getItem('yoru_active_profile_id') || 'profile-default';
    const crudo = localStorage.getItem(`yoru_settings_${perfil}`)
      || localStorage.getItem('yoru_settings');
    const valor = crudo ? JSON.parse(crudo).definitionSource : null;
    return valor === 'locales' || valor === 'jiten' ? valor : FUENTE_POR_DEFECTO;
  } catch {
    return FUENTE_POR_DEFECTO;
  }
}

/**
 * Qué decir cuando no se encontró nada, sin afirmar lo que no se ha comprobado.
 *
 * Con `locales` no se preguntó a Jiten, así que no se puede decir que no esté allí. Y
 * cuando Jiten no contestó, «no existe» sería mentira: lo que pasa es que no se supo.
 */
export function mensajeSinDefinicion(fuente: FuenteDefiniciones, noSePudoPreguntar: boolean): string {
  if (fuente === 'locales') return 'noDefFound';
  if (fuente === 'jiten') return noSePudoPreguntar ? 'noDefJitenCaido' : 'noDefJitenVacio';
  return noSePudoPreguntar ? 'noDefOffline' : 'noDefNinguno';
}

const JITEN_CACHE = new Map<string, DictionaryEntry>();

/*
  Qué no tiene sentido ir a buscar a internet.

  Cuando una palabra no está en los diccionarios del usuario se sale a la red, y eso
  cuesta hasta cinco segundos entre los dos intentos. Midiendo un libro de verdad —300
  palabras distintas— resultó que parte de ese gasto se va en gramática: partículas como
  ものの, として, によって, すら o について, y auxiliares como べし. No son palabras que
  nadie busque en un diccionario, y ninguna búsqueda las va a encontrar.

  Solo se descartan esas dos categorías. Se probó filtrar por más y no se sostiene: los
  trozos que deja el analizador vienen marcados como 動詞 y 名詞, mezclados con palabras
  legítimas de la misma categoría —くだる, 間引く, 贋作, 風聞—, así que filtrar por ahí
  escondería media novela. 助詞 y 助動詞 es lo único seguro.

  La búsqueda local **se sigue haciendo igual**: cuesta medio milisegundo y a veces hay
  entrada. Lo que se ahorra es el viaje.
*/
export function mereceBuscarseFuera(pos: string): boolean {
  const categoria = (pos || '').split(',')[0].trim();
  return categoria !== '助詞' && categoria !== '助動詞';
}

/** La app está puesta en español. `db.ts` deja esta copia escrita en cada cambio de idioma. */
function appEnEspanol(): boolean {
  return idiomaDeLaApp() === 'es';
}

/**
 * En qué idioma están unas definiciones, si es otro que el de la app.
 *
 * Solo cuenta lo que se sabe: una glosa sin diccionario, o de un diccionario sin idioma
 * reconocible, no hace que se avise. Y basta con que una acepción esté en el idioma de la
 * app para que no se avise.
 */
export function idiomaAjeno(definitions: (string | DictionaryDefinition)[], idiomaApp: IdiomaDefiniciones): IdiomaDefiniciones | undefined {
  let ajeno: IdiomaDefiniciones | undefined;
  for (const def of definitions || []) {
    if (typeof def === 'string') return undefined;
    const idioma = idiomaDeDiccionario(def?.dictionary || '');
    if (idioma === null || idioma === idiomaApp) return undefined;
    ajeno = idioma;
  }
  return ajeno;
}

/** Acentos y palabras que en inglés no salen; sirven para una glosa suelta, sin nombre de diccionario. */
const PISTAS_ESPANOL = /[áéíóúñ¡¿]|\b(el|la|los|las|un|una|de|que|con|por|para|ser|estar|hacer)\b/i;

/** De una lista de acepciones, las que vienen de un diccionario en español. */
function glosasEnEspanol(definitions: any[]): any[] {
  return (definitions || []).filter((def) => {
    if (typeof def === 'string') return PISTAS_ESPANOL.test(def);
    const nombre = String(def?.dictionary || '');
    if (/espa(ñ|n)ol|spanish/i.test(nombre)) return true;
    // Diccionario sin nombre reconocible: se mira la glosa.
    return !nombre && PISTAS_ESPANOL.test(String(def?.glossary || ''));
  });
}

// Look up a word (first in local database, then on Jiten.moe API via CORS proxy)
export async function lookupWord(word: string, reading: string = '', pos: string = ''): Promise<DictionaryEntry | null> {
  // 1. Clean the word: remove trailing particles or spaces
  const cleanWord = word.trim();
  if (!cleanWord) return null;

  // Split spelling and reading if formatted as spelling:reading (Yomitan key format)
  let searchWord = cleanWord;
  let searchReading = reading;
  if (cleanWord.includes(':')) {
    const parts = cleanWord.split(':');
    searchWord = parts[0].trim();
    searchReading = parts[1]?.trim() || reading;
  }
  const cacheKey = `${searchWord}\u0000${searchReading}`;

  let entry: DictionaryEntry | null = null;
  /** Jiten no llegó a contestar. Distinto de que contestara y no tuviera la palabra. */
  let noSePudoPreguntar = false;

  /*
    Quién parte las palabras manda sobre de dónde salen las definiciones.

    Decisión de zams (18 nov 2026): leyendo en modo Jiten, el diccionario es el de Jiten y solo
    el de Jiten. Tenía sentido pedirlo: las palabras ya vienen partidas por Jiten, con sus
    identificadores y sus estados, y que la tarjeta contestara luego con JMdict dejaba la mitad
    de la pantalla hablando de una fuente y la otra mitad de otra. En el modo del analizador de
    la app no se toca nada: ahí manda la elección de Ajustes, como hasta ahora.

    El tono y la frecuencia se siguen sacando de los diccionarios locales, porque no son
    definiciones y Jiten no los da: quitarlos sería perder el gráfico de tono y las insignias
    sin que nadie lo haya pedido.
  */
  const modoJiten = modoAnalizador() === 'jiten';
  const fuente: FuenteDefiniciones = modoJiten ? 'jiten' : leerFuente();
  const soloTonoYFrecuencia = modoJiten;

  /*
    Leyendo en español, las definiciones en español mandan sobre las de Jiten.

    Jiten solo tiene inglés. No es que no se le esté pidiendo español: su API no lo ofrece
    (comprobado el 18 nov 2026 en su propio swagger, https://api.jiten.moe/swagger/v1/swagger.json:
    ni `/vocabulary/search` ni `/reader/parse` aceptan idioma, y las acepciones son las glosas
    inglesas de JMdict). Así que pedírselo en español no es posible.

    Lo que sí hay es el JMdict en español que la app instala desde Ajustes → Diccionarios. En
    modo Jiten, con la app en español, esas acepciones se quedan y Jiten no llega a preguntarse.
    Si no hay diccionario español instalado, no se inventa nada: sigue saliendo el inglés de
    Jiten, igual que hasta ahora.
  */
  const quiereEspanol = modoJiten && appEnEspanol();

  // 2. Prioritize Yomitan DB (IndexedDB) first, so user's installed dictionaries (Spanish, etc.) take precedence!
  // We use a 1.5-second timeout to prevent any IndexedDB locks/upgrades from hanging the UI
  if (fuente !== 'jiten' || soloTonoYFrecuencia) try {
    const yomitanPromise = searchYomitanDB(searchWord, searchReading, pos);
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    
    const yomitanMatch = await Promise.race([yomitanPromise, timeoutPromise]) as any;
    if (yomitanMatch) {
      entry = {
        ...yomitanMatch,
        definitions: yomitanMatch.fullDefinitions || yomitanMatch.definitions
      };
      // En modo Jiten nos quedamos con el tono y la frecuencia, nunca con el significado…
      // …salvo que el significado esté en español y la app también. Ver `quiereEspanol`.
      if (soloTonoYFrecuencia && entry) {
        entry.definitions = quiereEspanol ? glosasEnEspanol(entry.definitions) : [];
      }
    }
  } catch (err) {
    console.error('Yomitan DB search error:', err);
  }

  /*
    3. Jiten, según de dónde haya dicho el usuario que quiere las definiciones.

    Con `locales` no se sale nunca: lo que no esté en casa, no está. Con `jiten` se
    pregunta siempre, porque arriba ni se miró la base local. Y con `ambos` —lo de
    siempre— solo cuando los diccionarios del usuario no tenían la palabra.

    El filtro de partículas sigue mandando en los dos casos en que se sale: ni una
    partícula ni un auxiliar valen un viaje a la red.
  */
  const faltaDefinicion = !entry || !entry.definitions || entry.definitions.length === 0;
  if (fuente !== 'locales' && faltaDefinicion && mereceBuscarseFuera(pos)) {
    let jitenEntry: DictionaryEntry | null = null;
    if (JITEN_CACHE.has(cacheKey)) {
      jitenEntry = { ...JITEN_CACHE.get(cacheKey)! };
    } else {
      try {
        const jitenUrl = `https://api.jiten.moe/api/vocabulary/search?query=${encodeURIComponent(searchWord)}`;
        /*
          Si Jiten no contesta, se acaba aquí.

          Antes, cuando Jiten fallaba, la palabra se reenviaba a `api.allorigins.win`,
          un proxy público ajeno. O sea: cada palabra que el usuario no tenía en sus
          diccionarios acababa en manos de un tercero con el que nadie había contado, y
          todo para cubrir el caso de que Jiten ya hubiera fallado. Fuera, por decisión
          de zams (15 nov 2026). Jiten se queda: ese lo conoce y lo usa.

          De paso, la espera máxima baja de cinco segundos a dos y medio.
        */
        const controlador = new AbortController();
        const plazo = setTimeout(() => controlador.abort(), 2500);
        let fetchedJson: any = null;
        try {
          const response = await fetch(jitenUrl, { signal: controlador.signal });
          if (!response.ok) throw new Error(`Jiten returned HTTP ${response.status}`);
          fetchedJson = await response.json();
        } catch {
          // Sin conexión, Jiten caído, o tardó demasiado. No hay más sitios donde mirar,
          // y se apunta: «no se pudo preguntar» no es lo mismo que «no existe».
          noSePudoPreguntar = true;
        } finally {
          clearTimeout(plazo);
        }

        if (fetchedJson && Array.isArray(fetchedJson.results) && fetchedJson.results.length > 0) {
          const definitions: any[] = [];
          const results = [...fetchedJson.results];
          if (searchReading) {
            results.sort((a: any, b: any) => Number(b.rubyText === searchReading) - Number(a.rubyText === searchReading));
          }
          results.slice(0, 4).forEach((res: any) => {
            if (res.meanings && res.meanings.length > 0) {
              res.meanings.forEach((m: string) => {
                definitions.push({
                  dictionary: 'Jiten',
                  glossary: m,
                  partsOfSpeech: res.partsOfSpeech || []
                });
              });
            }
          });
          
          if (definitions.length > 0) {
            const match = fetchedJson.results[0];
            jitenEntry = {
              word: match.text || searchWord,
              reading: match.rubyText || '',
              definitions: definitions.slice(0, 5),
              partsOfSpeech: match.partsOfSpeech || [],
              isFromJisho: false
            };
            
            JITEN_CACHE.set(cacheKey, jitenEntry);
          }
        }
      } catch (error) {
        console.warn('Jiten API lookup failed.', error);
      }
    }

    if (jitenEntry) {
      if (entry) {
        entry.definitions = jitenEntry.definitions;
        if (!entry.reading) entry.reading = jitenEntry.reading;
      } else {
        entry = jitenEntry;
      }
    }
  }

  /*
    No se encontró en ningún sitio.

    El texto de aquí es el de respaldo; la interfaz lo sustituye por uno traducido
    mirando `isFallback`. Aun así dice lo que de verdad ha pasado, porque antes decía
    «pulsa Buscar en Jiten para una búsqueda online» cuando Jiten ya se había
    intentado y había fallado, y no había ningún botón que pulsar.

    `sinConexion` separa los dos casos, que no son lo mismo para quien lee: que la
    palabra no exista en ninguna parte, o que no se haya podido preguntar. Lo segundo
    se arregla solo más tarde.
  */
  /*
    Se mira también la entrada sin significados, no solo que no haya entrada.

    En modo Jiten la búsqueda local se usa solo para el tono y la frecuencia, así que una
    palabra que Jiten no tenga deja una entrada con la lista de definiciones vacía. Sin esto,
    la tarjeta salía con el título y el gráfico de tono y un hueco donde va el significado, sin
    decir siquiera que no se había encontrado.
  */
  if (!entry || !entry.definitions || entry.definitions.length === 0) {
    entry = {
      ...(entry || {}),
      word: entry?.word || searchWord,
      reading: entry?.reading || searchReading || '',
      partsOfSpeech: entry?.partsOfSpeech?.length ? entry.partsOfSpeech : ['Unknown'],
      definitions: ['—'],
      isFallback: true,
      sinConexion: noSePudoPreguntar,
      fuente,
    };
  } else {
    /*
      Si lo que se enseña está en otro idioma, que la tarjeta lo diga.

      Pasa cuando ningún diccionario en el idioma de la app tiene la palabra y responde el de
      respaldo —el JMdict inglés o Jiten, que solo tiene inglés—. Antes la palabra salía en
      inglés sin más, y parecía que el idioma de la app no se respetaba.
    */
    const otro = idiomaAjeno(entry.definitions, idiomaDeLaApp());
    entry = { ...entry, otroIdioma: otro };
  }

  return entry;
}
