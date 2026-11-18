/*
  Portado de Nanahoshi (https://github.com/Natsume-197/Nanahoshi), de Natsume:
  `packages/reader/src/read-listen/text-anchor.ts`. De ahí vienen las tres ideas que
  sostienen esto: anclar por desplazamientos de caracteres y no por elementos, pintar
  con la API de resaltado de CSS para no tocar el árbol, y tener un camino de respaldo
  donde esa API no exista. Usado con su permiso expreso bajo GPL; ver
  THIRD-PARTY-GRANTS.md.

  La resolución del ancla está reescrita para nuestro caso: nuestro índice guarda el
  desplazamiento del cue dentro del párrafo en caracteres ya normalizados, mientras que
  el suyo ancla sobre el texto del manifiesto.
*/

import { normalizeForMatch } from './readAlongAlignment';

/** El nombre del resaltado; el CSS lo pinta con `::highlight(frase-sonando)`. */
export const NOMBRE_RESALTADO = 'frase-sonando';

/*
  Por qué no se mete un `<span>` alrededor de la frase.

  El lector pagina con columnas de CSS. Meter una etiqueta cambia el contenido, y
  cambiar el contenido obliga al navegador a repaginar: el libro daría un salto en cada
  frase y la posición de lectura se movería sola mientras escuchas. La API de resaltado
  pinta rangos **sin tocar el árbol**, así que no hay reflujo ninguno.
*/
function soportaResaltadoCss(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/*
  Lo que la normalización borra no cuenta.

  El índice midió el desplazamiento sobre el texto normalizado —sin espacios, sin
  puntuación, en minúscula— pero el DOM tiene el texto tal cual. Así que se recorre
  carácter a carácter preguntando cuánto aporta cada uno al texto normalizado: la
  puntuación aporta cero y se salta sola, y las letras aportan uno.

  No sirve normalizar el párrafo entero y buscar dentro: la normalización pasa por
  NFKC, que puede juntar dos caracteres en uno, y entonces las posiciones del texto
  normalizado dejan de corresponderse con las del original. Carácter a carácter eso no
  puede pasar, y donde sí pasaría —katakana de ancho medio con su dakuten suelto— la
  cuenta no cuadra al final y se devuelve `null`, que es la señal para resaltar el
  párrafo entero. Peor sería resaltar el trozo equivocado con aplomo.
*/
function cuantoAporta(caracter: string): number {
  return normalizeForMatch(caracter).length;
}

/** Los nodos de texto del párrafo, saltándose el furigana y lo que no se lee. */
function nodosDeTexto(parrafo: Element): Text[] {
  const fuera = new Set(['RT', 'RP', 'SCRIPT', 'STYLE', 'NOSCRIPT']);
  const salida: Text[] = [];
  const paseo = document.createTreeWalker(parrafo, NodeFilter.SHOW_TEXT, {
    acceptNode(nodo) {
      for (let p = nodo.parentElement; p && p !== parrafo; p = p.parentElement) {
        if (fuera.has(p.tagName) || p.getAttribute('aria-hidden') === 'true') {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = paseo.nextNode(); n; n = paseo.nextNode()) salida.push(n as Text);
  return salida;
}

/**
 * El rango del DOM que ocupa una frase dentro de su párrafo, o `null`.
 *
 * `null` no es un fallo que haya que esconder: es la señal de que ahí no se puede
 * afinar y hay que resaltar el párrafo entero. Pasa cuando el motor acaba de rehacer el
 * capítulo y el texto todavía no cuadra, cuando el párrafo del DOM no es el que se
 * indexó, o en los casos raros de composición que la cuenta por caracteres no cubre.
 */
export function rangoDeFrase(
  parrafo: Element,
  desdeNormalizado: number,
  largoNormalizado: number,
): Range | null {
  if (desdeNormalizado < 0 || largoNormalizado <= 0) return null;
  const hastaNormalizado = desdeNormalizado + largoNormalizado;

  let contados = 0;
  let inicioNodo: Text | null = null;
  let inicioEn = 0;
  let finNodo: Text | null = null;
  let finEn = 0;

  for (const nodo of nodosDeTexto(parrafo)) {
    const texto = nodo.data;
    for (let i = 0; i < texto.length; i++) {
      // Los pares sustitutos van juntos: medio carácter no es un carácter.
      const codigo = texto.codePointAt(i)!;
      const ancho = codigo > 0xffff ? 2 : 1;
      const aporta = cuantoAporta(texto.slice(i, i + ancho));
      // El principio se marca en el primer carácter que **cuenta**: empezar en un
      // espacio o en una comilla dejaría el resaltado asomando antes de la frase.
      if (!inicioNodo && aporta > 0 && contados === desdeNormalizado) {
        inicioNodo = nodo;
        inicioEn = i;
      }
      contados += aporta;
      if (!finNodo && inicioNodo && contados >= hastaNormalizado) {
        finNodo = nodo;
        finEn = i + ancho;
      }
      if (ancho === 2) i++;
    }
  }

  // La cuenta no cuadró: el texto del DOM no es el que se indexó.
  if (!inicioNodo || !finNodo || contados < hastaNormalizado) return null;

  const rango = document.createRange();
  try {
    rango.setStart(inicioNodo, inicioEn);
    rango.setEnd(finNodo, finEn);
  } catch {
    return null;
  }
  return rango.collapsed ? null : rango;
}

/**
 * Pinta ese rango como la frase que suena, y borra el anterior.
 *
 * Con `null` se limpia y ya. Devuelve `true` si se pintó de verdad: quien llama
 * necesita saberlo para caer al párrafo entero cuando no se pudo.
 */
export function pintarFrase(rango: Range | null): boolean {
  if (!soportaResaltadoCss()) return pintarDeRespaldo(rango);
  const registro = (CSS as any).highlights as Map<string, unknown>;
  if (!rango) {
    registro.delete(NOMBRE_RESALTADO);
    return false;
  }
  registro.set(NOMBRE_RESALTADO, new Highlight(rango));
  return true;
}

/*
  Donde no haya API de resaltado.

  Nuestro Chromium la tiene, pero Yoru también corre en el WebView de Android y en
  máquinas que no elegimos nosotros. Aquí no vale recurrir a envolver la frase en una
  etiqueta, por lo dicho arriba del repaginado, así que el respaldo dibuja los
  rectángulos del rango en una capa aparte, por encima del texto y sin tocarlo.

  Y hay que rehacerla cuando el texto se mueve sin que la frase cambie: al pasar de
  página o al cambiar el tamaño de la ventana, los rectángulos se quedarían donde
  estaban y marcarían el sitio equivocado. El resaltado de verdad no tiene ese
  problema porque lo sigue el navegador; este no, así que escucha. Los oyentes se
  ponen solo si este camino llega a usarse: donde hay API de resaltado, nada.
*/
let capaRespaldo: HTMLElement | null = null;
let ultimoRango: Range | null = null;
let escuchando = false;

function escucharMovimientos() {
  if (escuchando || typeof window === 'undefined') return;
  escuchando = true;
  const rehacer = () => { if (ultimoRango) pintarDeRespaldo(ultimoRango); };
  window.addEventListener('resize', rehacer, { passive: true });
  // En captura, porque quien se desplaza es el contenido del lector, no la ventana.
  window.addEventListener('scroll', rehacer, { capture: true, passive: true });
}

function pintarDeRespaldo(rango: Range | null): boolean {
  ultimoRango = rango;
  if (!rango) {
    capaRespaldo?.replaceChildren();
    return false;
  }
  escucharMovimientos();
  const parrafo = rango.startContainer.parentElement?.closest('p.chapter-content') as HTMLElement | null;
  const contenedor = (parrafo?.offsetParent as HTMLElement | null) ?? document.body;
  if (!capaRespaldo || !capaRespaldo.isConnected || capaRespaldo.parentElement !== contenedor) {
    capaRespaldo = document.createElement('div');
    capaRespaldo.className = 'frase-sonando-respaldo';
    capaRespaldo.setAttribute('aria-hidden', 'true');
    contenedor.appendChild(capaRespaldo);
  }
  const base = contenedor.getBoundingClientRect();
  const trozos: HTMLElement[] = [];
  for (const r of Array.from(rango.getClientRects())) {
    if (r.width < 1 && r.height < 1) continue;
    const trozo = document.createElement('div');
    trozo.className = 'frase-sonando-trozo';
    trozo.style.cssText = `left:${r.left - base.left}px;top:${r.top - base.top}px;`
      + `width:${r.width}px;height:${r.height}px;`;
    trozos.push(trozo);
  }
  capaRespaldo.replaceChildren(...trozos);
  return trozos.length > 0;
}
