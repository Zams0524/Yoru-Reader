"""El paso caro: pasar el audio por el modelo y guardar las emisiones.

Es el 99,6 % del trabajo (medido: 413 s de los 415 que cuesta alinear un capitulo de
14,7 min). Todo lo demas de esta herramienta es instantaneo. De ahi las dos decisiones
que manda este modulo:

**Se guarda en disco segun se calcula.** Un audiolibro de diez horas son ~4,7 horas de
CPU en un portatil normal. Que eso se pierda porque alguien cierra la consola no es
aceptable, asi que las emisiones van a un fichero mapeado en memoria y se apunta por
donde se iba. Si se vuelve a lanzar, sigue donde estaba.

**Y se guardan aparte del resultado.** Rehacer los cues con las emisiones ya calculadas
cuesta menos de un segundo. Mientras dura el trabajo valen su espacio (~0,3 GB por un
libro de diez horas, en float16); al terminar se tiran.

El troceado lleva solapamiento porque wav2vec2 deforma las activaciones en los bordes
del trozo; lo documenta J-MAC, que es un corpus de audiolibros japoneses. De cada pasada
se conserva solo el centro.
"""
from __future__ import annotations

import gc
import hashlib
import json
import os
import time
from dataclasses import dataclass

import numpy as np
import soundfile as sf

from .audio import SR

MODELO = "vumichien/wav2vec2-large-xlsr-japanese-hiragana"

#: Medido en un i5-8365U, comparando el mismo audio con cada configuracion:
#:
#:     cuerpo  borde   desperdicio   RTF
#:       10 s   1,50 s      29 %    0,537
#:       10 s   0,75 s      14 %    0,464
#:       20 s   1,50 s      14 %    0,497
#:       20 s   0,75 s       7 %    0,443   <- este
#:       30 s   1,00 s       6 %    0,490
#:
#: Dos cosas que no se adivinan sin medirlas. Recortar el borde ayuda, pero **menos de lo
#: que parece**: bajar el desperdicio del 29 % al 7 % solo quita un 17 % de tiempo, porque
#: los trozos grandes cuestan mas por segundo (la atencion es cuadratica) y se comen parte
#: de la ganancia. Y por eso 30 s ya empeora, aunque desperdicie menos que 20 s.
CUERPO_S = 20.0
BORDE_S = 0.75

#: Marcos por segundo que emite el modelo. Medido: 44.046 marcos para 882,7 s.
FPS = 49.90


@dataclass
class Emisiones:
    """Las log-probabilidades del modelo, marco a marco, y como leerlas."""

    datos: np.ndarray       # (marcos, clases) en float16
    fps: float
    duracion_s: float
    blank: int

    def __len__(self) -> int:
        return self.datos.shape[0]


def _clave(ruta_audio: str, cuerpo_s: float, borde_s: float) -> str:
    """Identifica el trabajo. Si cambian el audio o el troceado, la cache no vale."""
    st = os.stat(ruta_audio)
    crudo = f"{os.path.basename(ruta_audio)}|{st.st_size}|{cuerpo_s}|{borde_s}|{MODELO}"
    return hashlib.sha256(crudo.encode()).hexdigest()[:16]


def cargar_modelo(hilos: int = 0):
    """Carga el modelo. `hilos` a 0 deja que torch decida (suele acertar)."""
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    if hilos:
        torch.set_num_threads(hilos)
    proc = Wav2Vec2Processor.from_pretrained(MODELO)
    modelo = Wav2Vec2ForCTC.from_pretrained(MODELO).eval()
    return proc, modelo


def vocabulario(proc, n_clases: int) -> tuple[dict[str, int], dict[int, str], int]:
    """El vocabulario del modelo, y **el blank de verdad**.

    Cuidado, que cuesta una tarde: el tokenizador declara 88 entradas pero el modelo
    emite 86 clases, y el blank es el **85**, no el 0. El id 0 es `お`. Dando por supuesto
    que el blank es el 0, todo corre sin un solo error y los numeros salen plausibles
    mientras se trata una vocal como si fuera silencio. Hay que preguntarselo al
    tokenizador y comprobar que cae dentro de las clases que el modelo puede emitir.
    """
    blank = proc.tokenizer.pad_token_id
    if blank is None or blank >= n_clases:
        raise ValueError(f"el blank ({blank}) no cabe en las {n_clases} clases del modelo")
    vocab = {c: i for c, i in proc.tokenizer.get_vocab().items() if i < n_clases}
    return vocab, {i: c for c, i in vocab.items()}, blank


def calcular(
    ruta_wav: str,
    dir_trabajo: str,
    hilos: int = 0,
    cuerpo_s: float = CUERPO_S,
    borde_s: float = BORDE_S,
    # Con `flush`: si no, el progreso de un trabajo de horas no aparece hasta el final
    # cuando la salida va a un fichero en vez de a una consola.
    aviso=lambda *a: print(*a, flush=True),
) -> Emisiones:
    """Calcula (o retoma) las emisiones del audio entero.

    Se puede interrumpir con Ctrl-C y volver a lanzar: sigue por donde iba.
    """
    import torch

    os.makedirs(dir_trabajo, exist_ok=True)
    clave = _clave(ruta_wav, cuerpo_s, borde_s)
    f_npy = os.path.join(dir_trabajo, f"emisiones-{clave}.npy")
    f_est = os.path.join(dir_trabajo, f"emisiones-{clave}.json")

    audio, sr = sf.read(ruta_wav, dtype="float32")
    if sr != SR:
        raise ValueError(f"el audio debe venir a {SR} Hz y viene a {sr}")
    duracion = len(audio) / SR

    proc, modelo = cargar_modelo(hilos)
    n_clases = modelo.config.vocab_size
    _, _, blank = vocabulario(proc, n_clases)
    marcos_total = int(np.ceil(duracion * FPS)) + 8

    estado = {}
    if os.path.exists(f_est) and os.path.exists(f_npy):
        try:
            estado = json.load(open(f_est, encoding="utf-8"))
        except (OSError, ValueError):
            estado = {}
    hechos = int(estado.get("marcos_hechos", 0))
    pos = int(estado.get("muestras_hechas", 0))

    modo = "r+" if hechos and os.path.exists(f_npy) else "w+"
    mem = np.lib.format.open_memmap(
        f_npy, mode=modo, dtype=np.float16, shape=(marcos_total, n_clases)
    )
    if hechos:
        aviso(f"  retomando: ya habia {hechos} marcos ({pos/SR:.0f} s de audio)")

    cuerpo, borde = int(cuerpo_s * SR), int(borde_s * SR)
    t0 = time.perf_counter()
    muestras_ini = pos
    ultimo_aviso = 0.0

    while pos < len(audio):
        ini, fin = max(0, pos - borde), min(len(audio), pos + cuerpo + borde)
        x = proc(audio[ini:fin], sampling_rate=SR, return_tensors="pt").input_values
        with torch.inference_mode():
            em = torch.log_softmax(modelo(x).logits, dim=-1)[0].numpy()
        # tira los marcos del borde, que es para lo unico que se calcularon
        recorte_ini = int(round((pos - ini) / SR * FPS))
        recorte_fin = em.shape[0] - int(round((fin - (pos + cuerpo)) / SR * FPS))
        trozo = em[recorte_ini : max(recorte_ini, recorte_fin)]
        n = min(trozo.shape[0], marcos_total - hechos)
        if n > 0:
            mem[hechos : hechos + n] = trozo[:n].astype(np.float16)
            hechos += n
        pos += cuerpo

        pasado = time.perf_counter() - t0
        if pasado - ultimo_aviso > 20 or pos >= len(audio):
            ultimo_aviso = pasado
            hecho_s = min(pos, len(audio)) / SR
            avance = hecho_s - muestras_ini / SR
            rtf = pasado / max(avance, 1e-6)
            queda = (duracion - hecho_s) * rtf
            aviso(
                f"  {hecho_s/60:6.1f}/{duracion/60:.1f} min  "
                f"({100*hecho_s/duracion:4.1f} %)  RTF {rtf:.3f}  "
                f"faltan ~{queda/60:.0f} min"
            )
            mem.flush()
            json.dump(
                {"audio": os.path.basename(ruta_wav), "duracion_s": duracion,
                 "fps": FPS, "cuerpo_s": cuerpo_s, "borde_s": borde_s,
                 "marcos_hechos": hechos, "muestras_hechas": min(pos, len(audio))},
                open(f_est, "w", encoding="utf-8"), ensure_ascii=False,
            )

    mem.flush()
    total = time.perf_counter() - t0
    if total > 1:
        aviso(f"  modelo acustico: {total/60:.1f} min  |  RTF "
              f"{total/max(duracion-muestras_ini/SR,1e-6):.3f}")

    # Copia y **suelta el fichero**. En Windows un memmap abierto no se puede borrar
    # (WinError 32), asi que una vista sobre `mem` dejaria la cache imposible de tirar.
    datos = np.array(mem[:hechos], dtype=np.float16)
    _cerrar(mem)
    return Emisiones(datos=datos, fps=FPS, duracion_s=duracion, blank=blank)


def _cerrar(mem) -> None:
    """Suelta un memmap de verdad, para que Windows deje borrar el fichero."""
    try:
        base = mem
        while hasattr(base, "base") and base.base is not None:
            base = base.base
        if hasattr(base, "_mmap") and base._mmap is not None:
            base._mmap.close()
    except (AttributeError, BufferError, ValueError):
        pass
    del mem
    gc.collect()


def limpiar(dir_trabajo: str, aviso=print) -> int:
    """Tira las emisiones. Se llama al terminar: valen mientras dura el trabajo."""
    sueltos = 0
    if not os.path.isdir(dir_trabajo):
        return 0
    for nombre in os.listdir(dir_trabajo):
        if nombre.startswith("emisiones-"):
            ruta = os.path.join(dir_trabajo, nombre)
            try:
                tam = os.path.getsize(ruta)
                os.remove(ruta)
                sueltos += tam
            except OSError as e:
                # no es motivo para perder el SRT, que es lo que importa
                aviso(f"  no pude tirar {nombre} ({e.strerror}); borralo a mano")
    if sueltos:
        aviso(f"  emisiones tiradas: {sueltos/1e6:.0f} MB liberados")
    return sueltos
