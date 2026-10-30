"""Los cues, el SRT, y el portero que decide si esa pareja es pareja.

El cue lleva **el texto del libro, en kanji**. El kana con el que se alineo es andamio y
se tira aqui: si acabara dentro del cue, `timeOfText` de `readAlongAlignment.ts`
compararia `カタオモイノアイテ` contra `片思いの相手` y no casaria nunca, porque normaliza
puntuacion pero no convierte lecturas. Fallaria en todos los libros japoneses.

Y el portero. Se midio cual de las metricas sirve de verdad, y la respuesta fue
incomoda: **la confianza del CTC no sirve**. En la prueba, el caso malo (un audio que no
era el del texto) salio con la mejor confianza de todas, 1,00 de mediana, mejor que los
casos destrozados a proposito. Tiene sentido: el anclaje difuso ya ha descartado lo que
no casa antes de que la alineacion forzada lo vea, asi que esta solo mira texto que si
esta en el audio, y lo mira con total seguridad. Mide lo que queda, no lo que se tiro.

**La metrica que funciona es la cobertura.** Fue la unica que se movio (99,98 % -> 94,0 %)
y se mueve en proporcion exacta al dano, lo que la hace interpretable: un 94 % dice
«falta un 6 % del libro», no «algo va mal». Asi que el portero es cobertura y tasa de
anclaje. La confianza se calcula igual, porque no cuesta nada y sirve para senalar
*donde* falla dentro de un libro ya aceptado.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass

import numpy as np

#: Por debajo de esto, lo mas probable es que el audio y el libro no sean pareja.
UMBRAL_NO_ES_PAREJA = 0.70
#: Por debajo de esto hay alineacion, pero con agujeros que conviene mirar.
UMBRAL_DUDOSO = 0.95
#: Una narracion humana va a 6-9 kana/s. Fuera de esta banda el cue no es creible.
BANDA_KANA_S = (2.0, 20.0)
#: Un cue mas corto que esto no se puede seguir con la vista.
MINIMO_CUE_MS = 300


@dataclass
class Cue:
    ini_ms: int
    fin_ms: int
    texto: str


@dataclass
class Informe:
    """Lo que se escribe junto al SRT para poder decidir sin abrir el audio."""

    audio: str
    libro: str
    duracion_audio_s: float
    caracteres_libro: int
    caracteres_lectura: int
    cobertura: float
    #: Cuanto del AUDIO recibio texto. Es la mitad que falta: la cobertura del texto baja
    #: igual si no son pareja que si el audio es solo un trozo del libro, y estas dos
    #: cosas hay que distinguirlas. Si el audio esta cubierto, hay pareja aunque sea
    #: parcial; si no lo esta, hay voz que no supimos colocar, y eso es que no son pareja.
    cobertura_audio: float
    tasa_anclaje: float
    cues: int
    hueco_mas_largo_ms: int
    hueco_inicial_ms: int
    hueco_final_ms: int
    inversiones: int
    kana_por_s_mediana: float | None
    cues_fuera_de_banda: int
    confianza_mediana: float | None
    veredicto: str
    aviso: str


def construir_cues(libro, marco: np.ndarray, fps: float, min_car: int = 12) -> list[Cue]:
    """Agrupa la lectura en cues por frase y les pone el texto del libro.

    Corta donde el libro tiene puntuacion, que en la lectura quedo como separador `|`.
    """
    cues: list[Cue] = []
    lectura = libro.kana
    ini = 0
    for i, c in enumerate(lectura):
        final = i == len(lectura) - 1
        if not (final or (c == "|" and i - ini >= min_car)):
            continue
        tramo = marco[ini : i + 1]
        puestos = tramo[tramo >= 0]
        if len(puestos):
            texto = libro.tramo_original(ini, i + 1).strip()
            if texto:
                ini_ms = int(puestos.min() / fps * 1000)
                fin_ms = int(puestos.max() / fps * 1000)
                if fin_ms - ini_ms < MINIMO_CUE_MS:
                    fin_ms = ini_ms + MINIMO_CUE_MS
                cues.append(Cue(ini_ms=ini_ms, fin_ms=fin_ms, texto=texto))
        ini = i + 1
    cues.sort(key=lambda c: c.ini_ms)
    return cues


def _sello(ms: int) -> str:
    """`00:01:02,500`, como manda el SRT (con coma, no con punto)."""
    ms = max(0, ms)
    h, resto = divmod(ms, 3_600_000)
    m, resto = divmod(resto, 60_000)
    s, mil = divmod(resto, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{mil:03d}"


def escribir_srt(cues: list[Cue], ruta: str) -> None:
    """SRT, que es lo que `readAlongAlignment.ts` ya sabe leer."""
    with open(ruta, "w", encoding="utf-8") as f:
        for n, c in enumerate(cues, 1):
            # el texto de un cue no puede llevar lineas en blanco: separan bloques
            texto = " ".join(c.texto.split())
            f.write(f"{n}\n{_sello(c.ini_ms)} --> {_sello(c.fin_ms)}\n{texto}\n\n")


def evaluar(libro, col, cues: list[Cue], fps: float, duracion_s: float,
            nombre_audio: str, nombre_libro: str) -> Informe:
    """Mide la alineacion y dictamina. Sin abrir el audio, sin oir nada."""
    n_lectura = max(1, len(libro.kana))
    cobertura = col.colocados() / n_lectura
    tasa = col.anclado / n_lectura

    hueco = max((b.ini_ms - a.fin_ms for a, b in zip(cues, cues[1:])), default=0)
    inversiones = sum(1 for a, b in zip(cues, cues[1:]) if b.ini_ms < a.ini_ms)
    velocidades = [
        len(c.texto) / ((c.fin_ms - c.ini_ms) / 1000)
        for c in cues
        if c.fin_ms - c.ini_ms > MINIMO_CUE_MS
    ]
    conf = col.confianza[~np.isnan(col.confianza)]

    # cuanto del audio quedo cubierto por cues (uniendo los intervalos que se solapan)
    cubierto_ms = 0
    fin_previo = -1
    for c in cues:
        ini = max(c.ini_ms, fin_previo)
        if c.fin_ms > ini:
            cubierto_ms += c.fin_ms - ini
            fin_previo = c.fin_ms
    cob_audio = min(1.0, cubierto_ms / max(1.0, duracion_s * 1000))

    if cob_audio < UMBRAL_NO_ES_PAREJA:
        # Hay voz en el audio que no supimos colocar en el libro. Eso no es un libro
        # incompleto: es que este audio no es de este libro.
        veredicto = "no-es-pareja"
        aviso = (
            f"Solo el {100*cob_audio:.0f} % del audio ha recibido texto, y del libro "
            f"encaja el {100*cobertura:.0f} %. Queda voz sin colocar, asi que lo mas "
            "probable es que el EPUB y el audiolibro no sean la misma obra, o no el mismo "
            "tomo. Comprueba la pareja; no uses este SRT."
        )
    elif cobertura < UMBRAL_DUDOSO:
        # El audio si esta cubierto, asi que hay pareja: lo que pasa es que este audio
        # cubre solo una parte del libro. Es util, y es lo normal con tomos partidos.
        veredicto = "parcial"
        aviso = (
            f"El audio esta cubierto ({100*cob_audio:.0f} %), pero solo cubre el "
            f"{100*cobertura:.0f} % del libro. Es lo que pasa con un tomo partido en "
            "varios audios, o si este audio es un solo capitulo. Los cues valen para el "
            "tramo que cubren; el resto del libro se queda sin audio, que es lo correcto."
        )
    elif inversiones:
        veredicto = "dudoso"
        aviso = (
            f"Hay {inversiones} cues cuyo tiempo va hacia atras. No deberia pasar nunca; "
            "revisa este libro antes de usarlo."
        )
    else:
        veredicto = "bueno"
        aviso = ""

    return Informe(
        audio=nombre_audio,
        libro=nombre_libro,
        duracion_audio_s=round(duracion_s, 1),
        caracteres_libro=len(libro.original),
        caracteres_lectura=len(libro.kana),
        cobertura=round(cobertura, 4),
        cobertura_audio=round(cob_audio, 4),
        tasa_anclaje=round(tasa, 4),
        cues=len(cues),
        hueco_mas_largo_ms=int(hueco),
        hueco_inicial_ms=int(cues[0].ini_ms) if cues else 0,
        hueco_final_ms=int(max(0, duracion_s * 1000 - cues[-1].fin_ms)) if cues else 0,
        inversiones=inversiones,
        kana_por_s_mediana=round(float(np.median(velocidades)), 1) if velocidades else None,
        cues_fuera_de_banda=sum(
            1 for v in velocidades if v < BANDA_KANA_S[0] or v > BANDA_KANA_S[1]
        ),
        confianza_mediana=round(float(np.median(conf)), 3) if len(conf) else None,
        veredicto=veredicto,
        aviso=aviso,
    )


def escribir_informe(inf: Informe, ruta: str) -> None:
    json.dump(asdict(inf), open(ruta, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


def resumir(inf: Informe) -> str:
    """El resumen de una pantalla, para la consola."""
    marca = {"bueno": "OK", "parcial": "PARCIAL", "dudoso": "DUDOSO",
             "no-es-pareja": "NO ES PAREJA"}[inf.veredicto]
    lineas = [
        f"  veredicto:      {marca}",
        f"  del libro:      {100*inf.cobertura:.1f} % alineado"
        f"   (anclaje {100*inf.tasa_anclaje:.1f} %)",
        f"  del audio:      {100*inf.cobertura_audio:.1f} % con texto",
        f"  cues:           {inf.cues}",
        f"  hueco mayor:    {inf.hueco_mas_largo_ms/1000:.1f} s",
        f"  velocidad:      {inf.kana_por_s_mediana} kana/s"
        f"   ({inf.cues_fuera_de_banda} cues fuera de banda)",
        f"  inversiones:    {inf.inversiones}",
    ]
    if inf.aviso:
        lineas += ["", "  " + inf.aviso]
    return "\n".join(lineas)
