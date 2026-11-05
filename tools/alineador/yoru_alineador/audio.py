"""Preparar el audio: lo que haga falta -> WAV de 16 kHz y un canal.

Es la parte barata (14,7 min de audio se convierten en 0,8 s), asi que no se optimiza
nada aqui. Lo unico con algo de gracia es encontrar ffmpeg, porque en la maquina donde
se probo esto no estaba instalado como tal: venia dentro de Audiobookshelf.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass

SR = 16000

#: Sitios donde suele haber un ffmpeg aunque nadie lo haya instalado a proposito.
CANDIDATOS = (
    r"C:\Audiobookshelf\ffmpeg.exe",
    r"C:\Program Files\Audiobookshelf\ffmpeg.exe",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
)


def buscar(nombre: str = "ffmpeg") -> str:
    """La ruta de ffmpeg o ffprobe. Falla con un mensaje que dice que hacer."""
    if os.environ.get(nombre.upper()):
        return os.environ[nombre.upper()]
    hallado = shutil.which(nombre)
    if hallado:
        return hallado
    for ruta in CANDIDATOS:
        ruta = ruta.replace("ffmpeg", nombre)
        if os.path.exists(ruta):
            return ruta
    raise FileNotFoundError(
        f"no encuentro {nombre}. Instalalo, o apunta a uno que ya tengas con la "
        f"variable de entorno {nombre.upper()}=C:\\ruta\\a\\{nombre}.exe\n"
        "Si tienes Audiobookshelf, trae el suyo en C:\\Audiobookshelf\\."
    )


@dataclass
class Capitulo:
    numero: int
    titulo: str
    ini_s: float
    fin_s: float

    @property
    def duracion_s(self) -> float:
        return self.fin_s - self.ini_s


def sondear(ruta: str) -> tuple[float, list[Capitulo]]:
    """Duracion del audio y sus capitulos, si los trae (un .m4b suele traerlos)."""
    salida = subprocess.run(
        [buscar("ffprobe"), "-v", "error", "-print_format", "json",
         "-show_format", "-show_chapters", ruta],
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    datos = json.loads(salida.stdout)
    duracion = float(datos.get("format", {}).get("duration", 0.0))
    capitulos = [
        Capitulo(
            numero=i,
            titulo=(c.get("tags") or {}).get("title") or f"capitulo {i + 1}",
            ini_s=float(c["start_time"]),
            fin_s=float(c["end_time"]),
        )
        for i, c in enumerate(datos.get("chapters") or [])
    ]
    return duracion, capitulos


def a_wav(entrada: str, salida: str, ini_s: float = 0.0, dur_s: float | None = None) -> str:
    """Convierte (o recorta) a WAV de 16 kHz y un canal, que es lo que come el modelo."""
    orden = [buscar("ffmpeg"), "-v", "error", "-y"]
    if ini_s:
        orden += ["-ss", f"{ini_s:.3f}"]
    if dur_s:
        orden += ["-t", f"{dur_s:.3f}"]
    orden += ["-i", entrada, "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", salida]
    subprocess.run(orden, check=True, capture_output=True)
    return salida
