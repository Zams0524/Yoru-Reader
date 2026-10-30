#!/usr/bin/env python3
"""Alinea un EPUB con su audiolibro y deja un SRT que Yoru puede leer.

    python alinear.py --libro novela.epub --audio novela.m4b

Deja al lado del audio un `.srt` con los cues y un `.alineacion.json` con las medidas,
para poder decidir si sirve sin tener que oir nada.

Tarda horas, no minutos: en un portatil normal, unas 4,7 h por cada 10 h de audio. Se
puede cortar con Ctrl-C y volver a lanzar; sigue por donde iba.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from yoru_alineador import acustico, alineado, audio as mod_audio, salida, texto


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Alinea un EPUB con su audiolibro y escribe un SRT para Yoru.",
        epilog="Tarda unas 4,7 h por cada 10 h de audio. Ctrl-C y volver a lanzar retoma.",
    )
    p.add_argument("--libro", required=True, help="el EPUB")
    p.add_argument("--audio", required=True, help="el audiolibro (.m4b, .mp3, lo que sea)")
    p.add_argument("--salida", help="el SRT (por omision, junto al audio)")
    p.add_argument("--trabajo", help="carpeta para la cache de emisiones")
    p.add_argument("--hilos", type=int, default=0, help="hilos de CPU (0 = automatico)")
    p.add_argument("--desde", type=float, default=0.0, help="empezar en el segundo N")
    p.add_argument("--durante", type=float, help="alinear solo N segundos (para probar)")
    p.add_argument("--conservar-cache", action="store_true",
                   help="no tirar las emisiones al terminar (sirve para rehacer los cues)")
    a = p.parse_args(argv)

    for ruta, que in ((a.libro, "libro"), (a.audio, "audio")):
        if not os.path.exists(ruta):
            print(f"no existe el {que}: {ruta}", file=sys.stderr)
            return 2

    srt = a.salida or os.path.splitext(a.audio)[0] + ".srt"
    informe_json = os.path.splitext(srt)[0] + ".alineacion.json"
    trabajo = a.trabajo or os.path.join(os.path.dirname(os.path.abspath(srt)), ".alineacion")
    os.makedirs(trabajo, exist_ok=True)
    t_todo = time.perf_counter()

    print(f"libro: {os.path.basename(a.libro)}")
    print(f"audio: {os.path.basename(a.audio)}")

    # 1. El audio. Barato: 14,7 min se convierten en 0,8 s.
    dur_total, capitulos = mod_audio.sondear(a.audio)
    print(f"  duracion: {dur_total/3600:.2f} h"
          + (f" | {len(capitulos)} capitulos" if capitulos else " | sin capitulos"))
    wav = os.path.join(trabajo, "audio-16k.wav")
    recorte = a.durante or (dur_total - a.desde if a.desde else None)
    if not os.path.exists(wav) or a.desde or a.durante:
        print("  preparando el audio...")
        mod_audio.a_wav(a.audio, wav, ini_s=a.desde, dur_s=recorte)

    # 2. El texto. Tambien barato: segundos por tomo.
    print("  leyendo el libro...")
    t = time.perf_counter()
    libro = texto.leer_epub(a.libro)
    print(f"  texto: {len(libro.original)} caracteres -> {len(libro.kana)} de lectura"
          f"  ({time.perf_counter()-t:.0f} s)")
    if not libro.kana:
        print("el libro no da texto legible; nada que alinear", file=sys.stderr)
        return 1

    # 3. El modelo. Esto es el 99,6 % del trabajo.
    print("  pasando el audio por el modelo (esto es lo que tarda):")
    em = acustico.calcular(wav, trabajo, hilos=a.hilos)

    # 4. Colocar. Instantaneo, porque lo caro ya esta hecho.
    print("  colocando el texto...")
    proc, _ = acustico.cargar_modelo()
    vocab, id2ch, blank = acustico.vocabulario(proc, em.datos.shape[1])
    datos = em.datos.astype("float32")
    oido, marcos_oido = alineado.transcribir(datos, id2ch, blank)
    anclas, casados = alineado.anclar(libro.kana, oido, marcos_oido)
    col = alineado.colocar(datos, libro.kana, vocab, blank, anclas)
    col.anclado = casados

    # 5. El resultado, y el portero que decide si esa pareja es pareja.
    cues = salida.construir_cues(libro, col.marco, em.fps)
    inf = salida.evaluar(libro, col, cues, em.fps, em.duracion_s,
                         os.path.basename(a.audio), os.path.basename(a.libro))
    salida.escribir_srt(cues, srt)
    salida.escribir_informe(inf, informe_json)

    print()
    print(salida.resumir(inf))
    print()
    print(f"  SRT:      {srt}")
    print(f"  informe:  {informe_json}")
    print(f"  total:    {(time.perf_counter()-t_todo)/60:.1f} min")

    if a.conservar_cache:
        print("  (cache conservada: rehacer los cues ya no cuesta horas)")
    else:
        acustico.limpiar(trabajo)

    return 0 if inf.veredicto != "no-es-pareja" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ncortado. Vuelve a lanzar lo mismo y sigue por donde iba.")
        sys.exit(130)
