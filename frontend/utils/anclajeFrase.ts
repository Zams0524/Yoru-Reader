/*
  Resaltar en el texto la frase que suena.

  El índice de alineación dice dónde empieza cada frase dentro de su párrafo y cuánto
  mide, contado en caracteres del texto normalizado (sin espacios ni puntuación, en
  minúscula). Aquí se traduce esa cuenta a un `Range` del DOM y se pinta.

  Se pinta sin tocar el árbol: el lector pagina con columnas de CSS, y cualquier
  etiqueta nueva alrededor de la frase obligaría a repaginar, con el texto dando un
  salto en cada frase. Donde el navegador tiene `CSS.highlights` se usa eso; donde no,
  se dibujan rectángulos en una capa aparte por encima del texto.
*/

import { normalizeForMatch } from './readAlongAlignment';

/** Nombre del resaltado; el CSS lo pinta con `::highlight(frase-sonando)`. */
export const NOMBRE_RESALTADO = 'frase-sonando';

const ETIQUETAS_SIN_LECTURA = new Set(['RT', 'RP', 'SCRIPT', 'STYLE', 'NOSCRIPT']);

/** ¿Este nodo de texto está dentro de algo que no se lee (furigana, ocultos)? */
function esTextoMudo(nodo: Node, parrafo: Element): boolean {
  for (let el = nodo.parentElement; el && el !== parrafo; el = el.parentElement) {
    if (ETIQUETAS_SIN_LECTURA.has(el.tagName)) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
  }
  return false;
}

/** Un punto del DOM: el nodo de texto y la posición dentro de él. */
interface Punto {
  nodo: Text;
  pos: number;
}

/*
  Se normaliza carácter a carácter, no el párrafo entero de golpe: NFKC puede fundir dos
  caracteres en uno y entonces las posiciones dejarían de corresponderse. Uno a uno, cada
  carácter del DOM sabe cuántos caracteres normalizados aporta (cero la puntuación, uno
  una letra). Si en algún caso raro la cuenta no cuadra, se devuelve `null` y quien
  llama resalta el párrafo entero, que es mejor que resaltar el trozo equivocado.
*/
export function rangoDeFrase(
  parrafo: Element,
  desdeNormalizado: number,
  largoNormalizado: number,
): Range | null {
  if (desdeNormalizado < 0 || largoNormalizado <= 0) return null;
  const hasta = desdeNormalizado + largoNormalizado;

  let inicio: Punto | null = null;
  let fin: Punto | null = null;
  let cuenta = 0;

  const recorrido = document.createTreeWalker(parrafo, NodeFilter.SHOW_TEXT);
  for (let n = recorrido.nextNode() as Text | null; n && !fin; n = recorrido.nextNode() as Text | null) {
    if (esTextoMudo(n, parrafo)) continue;
    // Recorrer por puntos de código, para no partir un par sustituto.
    let pos = 0;
    for (const caracter of n.data) {
      const aporta = normalizeForMatch(caracter).length;
      // El inicio cae en un carácter que cuenta, no en un espacio o una comilla previos.
      if (!inicio && aporta > 0 && cuenta === desdeNormalizado) inicio = { nodo: n, pos };
      cuenta += aporta;
      pos += caracter.length;
      if (inicio && cuenta >= hasta) {
        fin = { nodo: n, pos };
        break;
      }
    }
  }

  if (!inicio || !fin) return null;
  try {
    const rango = document.createRange();
    rango.setStart(inicio.nodo, inicio.pos);
    rango.setEnd(fin.nodo, fin.pos);
    return rango.collapsed ? null : rango;
  } catch {
    return null;
  }
}

function hayResaltadoNativo(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/**
 * Pinta el rango como la frase que suena (y quita el anterior); `null` solo limpia.
 * Devuelve `true` si quedó pintado, para que quien llama pueda resaltar el párrafo
 * entero cuando no.
 */
export function pintarFrase(rango: Range | null): boolean {
  if (!hayResaltadoNativo()) return capa.pintar(rango);
  const registro = (CSS as any).highlights as Map<string, unknown>;
  if (!rango) {
    registro.delete(NOMBRE_RESALTADO);
    return false;
  }
  registro.set(NOMBRE_RESALTADO, new Highlight(rango));
  return true;
}

/*
  La capa de rectángulos, para los WebView sin `CSS.highlights`.

  A diferencia del resaltado nativo, unos rectángulos fijos no acompañan al texto: si la
  página se desplaza o la ventana cambia de tamaño, hay que volver a calcularlos. Los
  oyentes se ponen la primera vez que la capa se usa, nunca donde no hace falta.
*/
const capa = {
  elemento: null as HTMLElement | null,
  rango: null as Range | null,
  oyendo: false,

  oir() {
    if (this.oyendo || typeof window === 'undefined') return;
    this.oyendo = true;
    const repintar = () => { if (this.rango) this.pintar(this.rango); };
    window.addEventListener('resize', repintar, { passive: true });
    // En captura: lo que se desplaza es el contenedor del lector, no la ventana.
    window.addEventListener('scroll', repintar, { capture: true, passive: true });
  },

  contenedorDe(rango: Range): HTMLElement {
    const parrafo = rango.startContainer.parentElement?.closest('p.chapter-content') as HTMLElement | null;
    return (parrafo?.offsetParent as HTMLElement | null) ?? document.body;
  },

  pintar(rango: Range | null): boolean {
    this.rango = rango;
    if (!rango) {
      this.elemento?.replaceChildren();
      return false;
    }
    this.oir();
    const contenedor = this.contenedorDe(rango);
    if (!this.elemento?.isConnected || this.elemento.parentElement !== contenedor) {
      this.elemento = document.createElement('div');
      this.elemento.className = 'frase-sonando-respaldo';
      this.elemento.setAttribute('aria-hidden', 'true');
      contenedor.appendChild(this.elemento);
    }
    const origen = contenedor.getBoundingClientRect();
    const rectangulos = Array.from(rango.getClientRects())
      .filter((r) => r.width >= 1 || r.height >= 1)
      .map((r) => {
        const div = document.createElement('div');
        div.className = 'frase-sonando-trozo';
        Object.assign(div.style, {
          left: `${r.left - origen.left}px`,
          top: `${r.top - origen.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        return div;
      });
    this.elemento.replaceChildren(...rectangulos);
    return rectangulos.length > 0;
  },
};
