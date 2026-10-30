"""El lado del texto: de un EPUB en kanji a la lectura en kana que oye el modelo.

El modelo acustico no puede leer kanji, porque un kanji no tiene un sonido, tiene
varios. Asi que se alinea sobre la **lectura**, y por eso hace falta llevar la cuenta de
que trozo del libro corresponde a cada kana: el cue que acaba en el SRT lleva el texto
original, en kanji, no la lectura. Esa correspondencia es `kana_a_orig`.

Dos fuentes para la lectura, y se prefiere la primera:

1. **El furigana del propio EPUB** (`<ruby>漢字<rt>かんじ</rt></ruby>`). Es la lectura que
   quiso el editor, y cubre justo los kanji raros donde un analizador falla.
2. **janome**, para todo lo demas.
"""
from __future__ import annotations

import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from xml.etree import ElementTree

from janome.tokenizer import Tokenizer

# El vocabulario del modelo: hiragana, la marca de vocal larga y el separador de palabra.
HIRAGANA = set(chr(c) for c in range(0x3041, 0x3097))
VOCALES_LARGAS = {"ー"}
SEPARADOR = "|"
PERMITIDO = HIRAGANA | VOCALES_LARGAS | {SEPARADOR}

# Puntuacion que marca una pausa. Se convierte en separador: le da al alineador los
# mismos puntos de apoyo que tenia el modelo cuando se entreno.
PAUSA = set("、。，．,.!?！？…―「」『』（）()〈〉《》【】〔〕・:;：；\n\t 　")

# Etiquetas cuyo contenido no se lee en voz alta.
NO_SE_LEE = {"script", "style", "head", "title"}

# Etiquetas que separan parrafos: dejan una pausa en el texto original.
BLOQUE = {"p", "div", "br", "h1", "h2", "h3", "h4", "li", "blockquote"}


def kata_a_hira(s: str) -> str:
    """Katakana a hiragana. El modelo solo emite hiragana."""
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


@dataclass
class TextoLibro:
    """El texto del libro en sus dos formas, y el puente entre ellas."""

    original: str = ""
    kana: str = ""
    #: para cada caracter de `kana`, su indice en `original`
    kana_a_orig: list[int] = field(default_factory=list)
    #: (nombre del documento del EPUB, indice en `original` donde empieza)
    partes: list[tuple[str, int]] = field(default_factory=list)

    def tramo_original(self, kana_ini: int, kana_fin: int) -> str:
        """El texto del libro, en kanji, que corresponde a un tramo de la lectura.

        Esto es lo que va dentro del cue. Nunca el kana.
        """
        if not self.kana_a_orig or kana_ini >= len(self.kana_a_orig):
            return ""
        kana_fin = max(kana_ini + 1, min(kana_fin, len(self.kana_a_orig)))
        a = self.kana_a_orig[kana_ini]
        b = max(self.kana_a_orig[kana_ini:kana_fin])
        return self.original[a : b + 1]


class _Extractor(HTMLParser):
    """Saca del XHTML una lista de (texto, lectura_o_None), respetando el furigana."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.trozos: list[tuple[str, str | None]] = []
        self._ignorar = 0
        self._en_ruby = False
        self._base: list[str] = []
        self._lectura: list[str] = []
        self._en_rt = False

    def handle_starttag(self, tag, attrs):
        if tag in NO_SE_LEE:
            self._ignorar += 1
        elif tag == "ruby":
            self._en_ruby, self._base, self._lectura = True, [], []
        elif tag in ("rt", "rp"):
            self._en_rt = True
        elif tag in BLOQUE:
            self.trozos.append(("\n", None))

    def handle_startendtag(self, tag, attrs):
        if tag in BLOQUE:
            self.trozos.append(("\n", None))

    def handle_endtag(self, tag):
        if tag in NO_SE_LEE:
            self._ignorar = max(0, self._ignorar - 1)
        elif tag == "ruby":
            base, lec = "".join(self._base), "".join(self._lectura)
            if base:
                self.trozos.append((base, lec or None))
            self._en_ruby = False
        elif tag in ("rt", "rp"):
            self._en_rt = False

    def handle_data(self, data):
        if self._ignorar:
            return
        if self._en_ruby:
            (self._lectura if self._en_rt else self._base).append(data)
        elif not self._en_rt:
            self.trozos.append((data, None))


def _documentos(ruta_epub: str) -> list[tuple[str, str]]:
    """Los documentos del EPUB en el orden en que se leen (el `spine` del OPF)."""
    salida: list[tuple[str, str]] = []
    with zipfile.ZipFile(ruta_epub) as z:
        cont = ElementTree.fromstring(z.read("META-INF/container.xml"))
        ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
        nodo = cont.find(".//c:rootfile", ns)
        if nodo is None:
            raise ValueError("el EPUB no declara su OPF en META-INF/container.xml")
        opf_ruta = nodo.get("full-path")
        opf = ElementTree.fromstring(z.read(opf_ruta))
        on = {"o": "http://www.idpf.org/2007/opf"}
        base = opf_ruta.rsplit("/", 1)[0] + "/" if "/" in opf_ruta else ""
        manifiesto = {
            it.get("id"): it.get("href") for it in opf.findall(".//o:manifest/o:item", on)
        }
        for ref in opf.findall(".//o:spine/o:itemref", on):
            href = manifiesto.get(ref.get("idref"))
            if not href:
                continue
            nombre = base + href
            try:
                salida.append((nombre, z.read(nombre).decode("utf-8", "replace")))
            except KeyError:
                continue
    return salida


def leer_epub(ruta_epub: str) -> TextoLibro:
    """Lee un EPUB y devuelve su texto, su lectura y el puente entre los dos."""
    tok = Tokenizer()
    libro = TextoLibro()
    orig: list[str] = []
    largo = 0          # longitud de `orig` ya acumulada, para no recontarla cada vez
    kana: list[str] = []
    mapa: list[int] = []
    partido = re.compile("([" + re.escape("".join(PAUSA)) + "]+)")

    def emitir(superficie: str, lectura: str) -> None:
        """Anade un trozo, apuntando de que caracter del original sale cada kana."""
        nonlocal largo
        ini = largo
        orig.append(superficie)
        largo += len(superficie)
        lec = kata_a_hira(unicodedata.normalize("NFKC", lectura))
        util = [c for c in lec if c in PERMITIDO]
        n = len(superficie)
        for i, c in enumerate(util):
            kana.append(c)
            # reparte los kana a lo largo de la superficie, de forma proporcional
            mapa.append(ini + min(n - 1, i * n // len(util)))

    def pausa(trozo: str) -> None:
        """La puntuacion entra en el original; en la lectura es un separador."""
        nonlocal largo
        ini = largo
        orig.append(trozo)
        largo += len(trozo)
        if kana and kana[-1] != SEPARADOR:
            kana.append(SEPARADOR)
            mapa.append(ini)

    for nombre, html in _documentos(ruta_epub):
        libro.partes.append((nombre, largo))
        ex = _Extractor()
        ex.feed(html)
        for texto, lectura in ex.trozos:
            if lectura is not None:
                emitir(texto, lectura)  # furigana del EPUB: manda sobre el analizador
                continue
            for trozo in partido.split(texto):
                if not trozo:
                    continue
                if trozo[0] in PAUSA:
                    pausa(trozo)
                else:
                    for t in tok.tokenize(trozo):
                        # janome marca con `*` lo que no sabe leer. El katakana ya es su
                        # propia lectura; para el resto se deja la superficie y que el
                        # filtro de vocabulario decida si aporta algo.
                        emitir(t.surface, t.surface if t.reading == "*" else t.reading)

    libro.original = "".join(orig)
    libro.kana = "".join(kana)
    libro.kana_a_orig = mapa
    return libro
