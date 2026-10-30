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
#: Cuanto de lo narrado tiene que encontrarse en el texto. No llega al 100 % ni en una
#: pareja perfecta, porque el reconocedor se equivoca; por debajo de la mitad, no son
#: el mismo libro.
UMBRAL_ANCLAJE = 0.50
#: Por debajo de esto hay alineacion, pero con agujeros que conviene mirar.
UMBRAL_DUDOSO = 0.95
#: Una narracion humana va a 6-9 kana/s. Fuera de esta banda el cue no es creible.
BANDA_KANA_S = (2.0, 20.0)
#: Un cue mas corto que esto no se puede seguir con la vista.
MINIMO_CUE_MS = 300

#: Cuanto se adelanta el comienzo de cada cue.
#:
#: Un modelo CTC es «peaky»: el pico de un caracter no cae donde empieza su sonido, cae
#: dentro. Asi que el primer caracter de una frase se marca tarde, y el subrayado va
#: siempre un poco por detras de la voz. Contrastado contra una alineacion ajena del
#: mismo libro y el mismo audio, el retraso resulto ser **un sesgo casi constante de
#: 723 ms**: quitandolo, la desviacion pasaba de 723 ms de mediana a 255 ms, y del 25 %
#: al 93 % de cues por debajo de medio segundo.
#:
#: El adelanto nunca invade el cue anterior, asi que no puede crear inversiones. La
#: cifra sale de **una** comparacion sobre **un** capitulo; conviene confirmarla con otra
#: pareja antes de darla por buena en general.
ADELANTO_CTC_MS = 700


@dataclass
class Cue:
    ini_ms: int
    fin_ms: int
    texto: str
    #: No es la novela: portada, aviso legal, indice, colofon, あとがき. Se escribe en el
    #: SRT como cualquier otro --el narrador lo lee, y borrarlo nos quitaria la senal de
    #: que el audio empieza con medio minuto de titulo-- pero va marcado para que el
    #: lector no lo subraye ni ofrezca saltar ahi.
    ajeno: bool = False


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


#: Donde termina una frase en el texto del libro.
FIN_DE_FRASE = "。！？!?" + chr(10)


def construir_cues(libro, marco: np.ndarray, fps: float, min_car: int = 12) -> list[Cue]:
    """Agrupa la lectura en cues por frase y les pone el texto del libro.

    Corta donde el libro tiene punto, no donde el modelo oye final de palabra. La
    lectura ya no lleva separadores (ver `texto.pausa()`), asi que el corte se mira en el
    texto original a traves de `kana_a_orig`. Sale mejor de todas formas: un EPUB tiene
    puntuacion de verdad y un reconocedor de voz no predice ninguna.
    """
    cues: list[Cue] = []
    lectura = libro.kana
    mapa = libro.kana_a_orig
    original = libro.original

    def cierra_frase(i: int) -> bool:
        """Entre este kana y el siguiente, ¿el libro pone un punto?"""
        desde = mapa[i]
        hasta = mapa[i + 1] if i + 1 < len(mapa) else len(original)
        return any(ch in FIN_DE_FRASE for ch in original[desde : max(desde + 1, hasta)])

    ini = 0
    for i, _c in enumerate(lectura):
        final = i == len(lectura) - 1
        if not (final or (i - ini >= min_car and cierra_frase(i))):
            continue
        tramo = marco[ini : i + 1]
        puestos = tramo[tramo >= 0]
        if len(puestos):
            texto = libro.tramo_original(ini, i + 1).strip()
            if texto:
                ini_ms = int(puestos.min() / fps * 1000)
                fin_ms = int(puestos.max() / fps * 1000)
                # adelanta el comienzo, sin pisar el cue anterior
                suelo = cues[-1].fin_ms if cues else 0
                ini_ms = max(suelo, ini_ms - ADELANTO_CTC_MS)
                if fin_ms - ini_ms < MINIMO_CUE_MS:
                    fin_ms = ini_ms + MINIMO_CUE_MS
                cues.append(Cue(ini_ms=ini_ms, fin_ms=fin_ms, texto=texto,
                                ajeno=libro.es_ajeno(mapa[ini])))
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


def escribir_srt(cues: list[Cue], ruta: str, inf: "Informe | None" = None) -> None:
    """SRT, que es lo que `readAlongAlignment.ts` ya sabe leer.

    Delante va el veredicto, en una linea que **no es un cue**. Yoru la lee para saber si
    puede fiarse; cualquier otro programa la salta, porque no lleva `-->`, asi que el
    fichero sigue siendo un SRT corriente. Va dentro y no solo en el `.json` de al lado
    para que no pueda perderse por el camino: importar el SRT sin su veredicto es
    exactamente el caso que no queremos.
    """
    with open(ruta, "w", encoding="utf-8") as f:
        if inf is not None:
            # Los cues que no son la novela se marcan **aqui**, no en su texto: asi no
            # se ensucia el SRT y cualquier otro programa los ve como cues normales.
            # En tramos (inicio, fin) de indice de cue, que ocupa mucho menos que la
            # lista suelta y se lee igual de facil.
            ajenos, ini = [], None
            for n, c in enumerate(cues):
                if c.ajeno and ini is None:
                    ini = n
                elif not c.ajeno and ini is not None:
                    ajenos.append([ini, n - 1]); ini = None
            if ini is not None:
                ajenos.append([ini, len(cues) - 1])
            cabecera = json.dumps(
                {"verdict": inf.veredicto, "coverage": inf.cobertura,
                 "audioCoverage": inf.cobertura_audio, "notice": inf.aviso,
                 "aside": ajenos},
                ensure_ascii=False, separators=(",", ":"),
            )
            f.write(f"YORU-ALINEACION v1 {cabecera}\n\n")
        for n, c in enumerate(cues, 1):
            # el texto de un cue no puede llevar lineas en blanco: separan bloques
            texto = " ".join(c.texto.split())
            f.write(f"{n}\n{_sello(c.ini_ms)} --> {_sello(c.fin_ms)}\n{texto}\n\n")


def evaluar(libro, col, cues: list[Cue], fps: float, duracion_s: float,
            nombre_audio: str, nombre_libro: str, oido_len: int = 0) -> Informe:
    """Mide la alineacion y dictamina. Sin abrir el audio, sin oir nada."""
    n_lectura = max(1, len(libro.kana))
    cobertura = col.colocados() / n_lectura
    # La tasa de anclaje se mide contra **lo que se oye**, no contra el libro entero:
    # un capitulo de un tomo cubre el 2 % del libro y eso no dice nada de si son pareja.
    # Lo que si lo dice es cuanto de lo narrado aparece en el texto.
    tasa = col.anclado / max(1, oido_len or n_lectura)

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

    if cob_audio < UMBRAL_NO_ES_PAREJA or tasa < UMBRAL_ANCLAJE:
        # Dos maneras de no ser pareja, y hacen falta las dos. Que quede voz sin colocar
        # dice que el audio narra algo que no esta en el libro. Que lo narrado no se
        # encuentre en el texto dice lo mismo desde el otro lado, y pilla el caso en que
        # el audio se reparte entre trozos sueltos del libro que casan por casualidad.
        veredicto = "no-es-pareja"
        aviso = (
            f"Solo el {100*cob_audio:.0f} % del audio ha recibido texto, y del libro "
            f"encaja el {100*cobertura:.0f} % (de lo narrado se encuentra en el texto el "
            f"{100*tasa:.0f} %). Lo mas probable es que el EPUB y el audiolibro no sean "
            "la misma obra, o no el mismo tomo. Comprueba la pareja; no uses este SRT."
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
