# Cesiones de terceros

Este fichero recoge el código de terceros que usa Yoru Reader: de dónde viene, de quién es
y con qué licencia o permiso está aquí. Si alguien duda dentro de un año de dónde salió
una parte del lector, la respuesta tiene que estar en este fichero.

Nada se porta antes de quedar anotado aquí.

---

## Jiten Reader — chinokusari y Sirus

- **Repositorio**: <https://github.com/Sirush/JitenReader>
- **Licencia**: MIT (Copyright (c) 2025 chinokusari, Copyright (c) 2026 Sirus). Aquí no hace
  falta una cesión aparte: la MIT ya permite usar y adaptar el código dentro de un proyecto
  GPL, con tal de conservar el aviso de autoría. Se anota igualmente para que se sepa de
  dónde salió.
- **Qué se usa**: la extensión de lectura entera (`backend/reader-ext`, desde el fork
  `Zams0524/JitenReader`), y en `frontend/utils/furiganaJiten.ts` la forma de colocar el
  furigana de la lectura anotada por su posición y la tabla de lecturas de 来る y 得る
  conjugados, adaptadas de `src/background-worker/parser/parser.ts`.
- **Cómo se marca**: la cabecera del fichero dice de dónde viene y de quién es.
