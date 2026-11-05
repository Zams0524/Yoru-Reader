"""Colocar el texto del libro sobre el audio, y negarse cuando no se puede.

Dos piezas, y la primera es la que hace el trabajo de verdad.

**Anclaje difuso.** El texto de un EPUB nunca coincide con su narracion: falta una frase
que el narrador se salto, sobra un epigrafe que nadie lee en voz alta, un numero se lee
de otra manera. Asi que primero se mira que oye el modelo por su cuenta y se compara con
la lectura del libro (los dos en kana, que es justo por lo que alineamos en kana). Los
tramos que casan son los anclajes; los que no, se quedan fuera.

**Alineacion forzada por bloques.** Entre anclaje y anclaje, se le pide al modelo que
coloque exactamente ese trozo de texto en ese trozo de audio. Por bloques y no de una vez
porque el enrejado de Viterbi sobre 44.000 marcos y 12.000 caracteres no cabe en memoria,
y porque asi **un error no se propaga**: cada bloque es independiente del siguiente.

Medido sobre un capitulo real: con una frase borrada, un epigrafe insertado o una lectura
cambiada, los cues vuelven a su sitio en 0 a 4 caracteres y el 99,4 % queda a menos de
200 ms. Ni una inversion de tiempo, ni con siete destrozos a la vez.

La regla de esta herramienta, y no es negociable: **antes dejar un tramo sin alinear que
colocar un cue a ojo.** Quien lee esto esta aprendiendo japones, y un subrayado que va
medio segundo tarde ensena mal; peor que no tener subrayado.
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass

import numpy as np

#: Marcos por bloque. 1.500 son ~30 s: el enrejado cabe de sobra y el solapamiento de
#: errores queda acotado a un bloque.
MARCOS_POR_BLOQUE = 1500


@dataclass
class Colocacion:
    """Donde cae cada caracter de la lectura, y con cuanta seguridad."""

    marco: np.ndarray        # marco de cada kana, o -1 si se quedo sin colocar
    confianza: np.ndarray    # probabilidad del CTC, o NaN
    anclado: int             # caracteres que el anclaje difuso dio por buenos

    def colocados(self) -> int:
        return int((self.marco >= 0).sum())


def transcribir(em, id2ch: dict[int, str], blank: int) -> tuple[str, np.ndarray]:
    """Que oye el modelo por su cuenta, y en que marco. Decodificacion voraz."""
    mejor = em.argmax(axis=-1)
    chars, marcos, ant = [], [], blank
    for t, i in enumerate(mejor):
        if i != blank and i != ant:
            c = id2ch.get(int(i))
            # el separador de palabra se tira: ver `texto.pausa()`
            if c and len(c) == 1 and c != "|":
                chars.append(c)
                marcos.append(t)
        ant = i
    return "".join(chars), np.asarray(marcos, dtype=np.int64)


#: Longitud de la semilla para localizar. Doce kana son unas cinco palabras: bastante
#: raro para no salir por casualidad, bastante corto para sobrevivir a un error del ASR.
SEMILLA = 12


def localizar(lectura: str, oido: str, margen: float = 0.35) -> tuple[int, int]:
    """Encuentra en que tramo del libro cae este audio, antes de intentar alinearlo.

    Sin este paso, lo que pasa con un libro de verdad es esto: el audio de un capitulo
    son ~3.500 kana y el tomo entero 161.000, y `difflib` sobre esa desproporcion no
    devuelve un tramo contiguo sino fragmentos diminutos repartidos por todo el libro.
    Medido con una pareja real: engancho con el aviso de copyright del final del EPUB y
    dio el 0,5 % de anclaje. No se vio antes porque en las pruebas el texto y el audio
    eran del mismo tamano, que es el unico caso en que no hace falta localizar.

    El metodo es contar votos por **desplazamiento**. Si el audio empieza en el caracter
    X del libro, casi todas las semillas que coincidan lo haran con esa misma distancia
    entre su sitio en el libro y su sitio en lo oido. Asi que se cuentan las distancias y
    gana la mas votada. Es una pasada sobre el libro y otra sobre el audio.
    """
    if len(lectura) <= len(oido) * 2:
        return 0, len(lectura)  # el libro no es mucho mayor: no hay nada que localizar

    # Donde esta cada semilla del libro. Las que se repiten muchisimo no distinguen
    # nada y solo meten ruido, asi que se les pone tope.
    donde: dict[str, list[int]] = {}
    for i in range(len(lectura) - SEMILLA + 1):
        donde.setdefault(lectura[i : i + SEMILLA], []).append(i)

    CUBO = 2000  # los votos se agrupan, porque el desplazamiento exacto no es constante
    votos: dict[int, int] = {}
    for j in range(0, len(oido) - SEMILLA + 1, 3):
        sitios = donde.get(oido[j : j + SEMILLA])
        if not sitios or len(sitios) > 12:
            continue
        for i in sitios:
            votos[(i - j) // CUBO] = votos.get((i - j) // CUBO, 0) + 1

    if not votos:
        return 0, len(lectura)  # ni una semilla: que decida el anclaje, y que falle
    mejor = max(votos, key=lambda k: votos[k]) * CUBO

    ancho = int(len(oido) * (1 + margen)) + CUBO
    ini = max(0, mejor - int(len(oido) * margen) - CUBO)
    return ini, min(len(lectura), ini + ancho + int(len(oido) * margen))


def anclar(
    lectura: str, oido: str, marcos_oido: np.ndarray
) -> tuple[list[tuple[int, int]], int, tuple[int, int]]:
    """Empareja la lectura del libro con lo que se oye, y devuelve (indice, marco).

    Solo de los tramos que casan. Lo que no casa no recibe anclaje, y por tanto tampoco
    recibira tiempo: es exactamente lo que queremos.

    Primero localiza el tramo del libro donde cae el audio, y solo compara ahi dentro.
    """
    ini, fin = localizar(lectura, oido)
    ventana = lectura[ini:fin]
    sm = difflib.SequenceMatcher(None, ventana, oido, autojunk=False)
    anclas: list[tuple[int, int]] = []
    casados = 0
    for a, b, n in sm.get_matching_blocks():
        casados += n
        for k in range(n):
            if b + k < len(marcos_oido):
                anclas.append((ini + a + k, int(marcos_oido[b + k])))
    return anclas, casados, (ini, fin)


def _bloques(anclas, n_marcos: int, marcos_por_bloque: int = MARCOS_POR_BLOQUE):
    """Parte en bloques por anclajes, de forma que el enrejado quepa."""
    fuera, i = [], 0
    while i < len(anclas):
        f0 = anclas[i][1]
        j = i
        while j + 1 < len(anclas) and anclas[j + 1][1] - f0 < marcos_por_bloque:
            j += 1
        c_ini, f_ini = anclas[i]
        c_fin, f_fin = anclas[j + 1] if j + 1 < len(anclas) else anclas[j]
        if c_fin > c_ini and f_fin > f_ini:
            fuera.append((c_ini, c_fin, f_ini, min(f_fin + 10, n_marcos)))
        i = j + 1
    return fuera


def colocar(em, lectura: str, vocab: dict[str, int], blank: int, anclas) -> Colocacion:
    """Alineacion forzada bloque a bloque."""
    import torch
    import torchaudio.functional as AF

    marco = np.full(len(lectura), -1, dtype=np.int64)
    conf = np.full(len(lectura), np.nan, dtype=np.float32)

    for c_ini, c_fin, f_ini, f_fin in _bloques(anclas, em.shape[0]):
        texto = lectura[c_ini:c_fin]
        ids = [vocab[c] for c in texto if c in vocab]
        idx = [k for k, c in enumerate(texto) if c in vocab]
        # si no hay marcos de sobra para los caracteres, el bloque no es creible
        if not ids or f_fin - f_ini < len(ids):
            continue
        lp = torch.from_numpy(np.asarray(em[f_ini:f_fin], dtype=np.float32)).unsqueeze(0)
        try:
            etiquetas, puntos = AF.forced_align(
                lp, torch.tensor([ids], dtype=torch.int32), blank=blank
            )
        except Exception:
            continue  # bloque imposible: se queda sin colocar, que es lo correcto
        et, pt = etiquetas[0].numpy(), puntos[0].numpy()
        k, ant = 0, blank
        for t, v in enumerate(et):
            if v != blank and v != ant:
                if k < len(idx):
                    marco[c_ini + idx[k]] = f_ini + t
                    conf[c_ini + idx[k]] = float(np.exp(pt[t]))
                    k += 1
            ant = v

    return Colocacion(marco=marco, confianza=conf, anclado=0)
