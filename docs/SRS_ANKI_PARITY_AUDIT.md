# Auditoría y Especificación de Paridad: SRS de Yoru-Reader vs. Anki (FSRS)

> **Destinatario:** Claude Code / Equipo de desarrollo de Yoru-Reader  
> **Objetivo:** Resolver todas las discrepancias de comportamiento entre el SRS de Yoru-Reader y el funcionamiento estándar de Anki (Scheduler v3 / FSRS), e implementar la importación completa de mazos de Anki con todo su estado, métricas y contenido.

---

## 1. Diagnóstico del Problema Principal ("Again" cierra la sesión)

### El síntoma
Cuando el usuario pulsa **Again (1)** de forma repetida en una tarjeta, o cuando falla las tarjetas restantes de la sesión, la sesión se da por terminada inmediatamente mostrando el mensaje *"¡Estás al día! Zero reviews due! No tienes palabras pendientes de repaso en este mazo..."*, en lugar de volver a presentar la tarjeta fallada como hace Anki.

### Causa raíz en el código (`frontend/components/SrsReviewModal.tsx`)
1. **Expulsión prematura de la cola activa:** En `submitGrade()` (líneas ~698–712):
   ```typescript
   const isLearningStep = [State.Learning, State.Relearning].includes(updatedCard.state)
     && new Date(updatedCard.due).getTime() > Date.now();
   if (isLearningStep) {
     const dueAt = updatedCard.due instanceof Date ? updatedCard.due.toISOString() : new Date(updatedCard.due).toISOString();
     setDueCards(prev => prev.slice(1)); // <-- Elimina la palabra de la cola activa
     setPendingCards(prev => [...prev.filter(card => card.word !== word), { word, dueAt }]); // <-- La manda a un temporizador
     setCurrentIndex(prev => prev + 1);
     setSessionCount(prev => prev + 1);
     setShowAnswer(false);
   }
   ```
2. **Disparo de pantalla vacía:**
   En la línea ~803:
   ```typescript
   {dueCards.length === 0 && !isFinished ? (
     <h3>¡Estás al día! / Zero reviews due!</h3>
     ...
     <button onClick={onClose}>Volver</button>
   ```
   Al vaciarse `dueCards` (porque todas las tarjetas falladas fueron a `pendingCards` para dentro de 1 minuto), el modal muestra la pantalla de felicitación/salida o finaliza la sesión (`isFinished`), impidiendo que el usuario complete su sesión de aprendizaje.

---

## 2. Inventario Completo de Discrepancias (Yoru-Reader vs. Anki)

### Discrepancia 1: Manejo de la Cola de Sesión (Session Queue)
* **Comportamiento en Anki:**
  * Toda tarjeta marcada con **Again** se mantiene **dentro de la sesión activa** hasta que se apruebe con *Good* o *Easy*.
  * Si quedan otras tarjetas en la cola, la tarjeta fallada se reinserta unos puestos más atrás (o al final de la cola).
  * Si es la única tarjeta restante, **se vuelve a mostrar inmediatamente** (o tras un breve aviso), pero **NUNCA** termina la sesión ni expulsa al usuario con "Zero reviews due".
* **Solución en Yoru-Reader:**
  * Al calificar con *Again*, reencolar la palabra al final de `dueCards`:
    ```typescript
    setDueCards(prev => [...prev.slice(1), word]);
    ```
  * Solo sacar definitivamente la tarjeta de `dueCards` cuando se gradúe con *Good* (último paso) o *Easy*.

---

### Discrepancia 2: Falta de "Learn Ahead Limit" (Límite de repaso por adelantado)
* **Comportamiento en Anki:**
  * Anki cuenta con el ajuste `Learn Ahead Limit` (por defecto **20 minutos**).
  * Si una tarjeta en aprendizaje está programada para dentro de 1 minuto (`learning_steps: ['1m', '10m']`), y no hay otras tarjetas de revisión listas en el mazo, Anki evalúa: `1 minuto <= 20 minutos`. Como está dentro del margen, la tarjeta se sirve de inmediato para que el flujo de estudio no se corte.
* **Fallo en Yoru-Reader:**
  * Depende de un `setTimeout` pasivo en `useEffect` esperando a que transcurran los 60.000 ms. El usuario se queda viendo una pantalla estática esperando que el reloj del sistema avance.
* **Solución en Yoru-Reader:**
  * Incorporar la regla de *Learn Ahead*: si `pendingCards` tiene tarjetas cuyo vencimiento es `< 20 minutos`, y `dueCards` está vacía, moverlas inmediatamente al frente de `dueCards` en lugar de mostrar la pantalla de "Zero reviews due".

---

### Discrepancia 3: Granularidad de Vencimiento (Días vs. Milisegundos) y Hora de Rollover (4:00 AM)
* **Comportamiento en Anki:**
  * Las tarjetas de **Repaso inter-día** (`Review`) vencen por **día calendario**, no por hora/segundo exacto.
  * Anki tiene una hora de corte diaria (**Next day starts at**, por defecto **4:00 AM**). Todas las tarjetas de ese día están listas para repasar desde las 4:00 AM de esa fecha.
* **Fallo en Yoru-Reader:**
  * En `db.ts`, el campo `due` se guarda con fecha y hora exacta (`ISOString: 2026-10-21T23:45:10.000Z`).
  * En `initSession`, se filtra con `dueDate <= now` (`now = new Date()`).
  * **Efecto negativo:** Si el usuario estudió anoche a las 23:45 y obtuvo un intervalo de 1 día, al día siguiente a las 15:00 la tarjeta NO está lista. Solo aparece a las 23:45 de la noche, fragmentando los repasos a lo largo del día.
* **Solución en Yoru-Reader:**
  * Para tarjetas en estado `Review` (intervalo >= 1 día), normalizar el vencimiento a la fecha del día con corte a las 4:00 AM local. Si la fecha calculada es hoy o anterior, la tarjeta está disponible desde el primer minuto del día de estudio.

---

### Discrepancia 4: Contabilidad del Límite Diario de Repasos
* **Comportamiento en Anki:**
  * El límite diario de repasos (`Max reviews/day`) cuenta **tarjetas únicas revisadas**, no los reintentos individuales de tarjetas falladas en aprendizaje.
* **Fallo en Yoru-Reader:**
  * En `submitGrade()`, cada clic registra una entrada en `db.addSrsHistory()`.
  * `reviewsFromHistory` cuenta todas las entradas del historial de hoy. Si fallas una misma tarjeta 4 veces con *Again*, te consume 4 unidades de tu cuota de repasos diarios (`reviewsLeftToday = maxReviewsLimit - reviewsDoneToday`).
* **Solución en Yoru-Reader:**
  * Contabilizar tarjetas únicas en el historial diario para el cómputo de `reviewsDoneToday`, evitando que los fallos penalicen la cuota del día.

---

### Discrepancia 5: El Botón "Hard" en Aprendizaje
* **Comportamiento en Anki / FSRS:**
  * En tarjetas nuevas o en reaprendizaje (`State.Learning`, `State.Relearning`):
    * **Again (1):** Regresa al paso inicial (`1m`).
    * **Hard (2):** Repite el paso actual o promedio (permanece en aprendizaje en la misma sesión).
    * **Good (3):** Pasa al siguiente paso (`10m`), o gradúa a Review si era el último paso.
    * **Easy (4):** Gradúa directamente a Review con intervalo inicial incrementado (ej. 4 días).
* **Solución en Yoru-Reader:**
  * Asegurarse de que `Hard` mantenga la tarjeta en la sesión actual para volver a verla antes de finalizar el estudio.

---

### Discrepancia 6: Posibilidad de "Enterrar" Tarjetas (Bury Card)
* **Comportamiento en Anki:**
  * Permite posponer una tarjeta para el día siguiente (tecla `-` / Bury) sin alterar su estabilidad ni marcarla como fallada.
* **Solución en Yoru-Reader:**
  * Añadir un botón o atajo de teclado para "Posponer a mañana" (`Bury`), moviendo su fecha de vencimiento al día siguiente sin modificar su historial FSRS.

---

## 3. Especificación: Importación Completa de Mazos de Anki (SRS y Contenido)

### Diagnóstico del Importador Actual (`frontend/components/VocabularyModal.tsx`)
Actualmente, la importación desde Anki tiene graves limitaciones que rompen la importación de un mazo completo:
1. **Filtro restrictivo `prop:ivl>=21` (Líneas 317–322):**
   * Por defecto, la consulta busca `prop:ivl>=21`.
   * **Consecuencia:** En un mazo típico (como el del usuario con **6000 tarjetas**: 5335 Nuevas [88.9%], 213 Jóvenes [3.5%], 452 Maduras [7.5%]), **el importador ignora el 92.5% del mazo (5548 tarjetas)** e importa únicamente las 452 maduras.
2. **Conversión forzada a "Conocidas" (`known`) (Líneas 512–535):**
   * El código asigna ciegamente `updated[w] = 'known'`, en lugar de colocarlas en su estado real de estudio (`learning` / nuevo / repaso).
3. **Pérdida de fechas de vencimiento reales:**
   * En lugar de leer cuándo vence la tarjeta en Anki (`due`), calcula una fecha inventada:
     `dueDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * (details.interval || 1)).toISOString()`
4. **Pérdida de métricas FSRS / SM-2:**
   * Se descartan los valores de `stability`, `difficulty`, `factor` (Ease), `lapses` (fallos acumulados) y fecha de último repaso.
5. **Pérdida de campos enriquecidos:**
   * Solo extrae la palabra aislada. Se pierde la lectura furigana/kana (`reading`), la oración de contexto (`sentence`), la definición/glosario (`glossary`) y el audio asociado.
6. **Sin soporte directo para archivos `.apkg` / `.colpkg`:**
   * Solo funciona si Anki Desktop está abierto en segundo plano con AnkiConnect. Si el usuario tiene un archivo exportado `.apkg`, no tiene cómo cargarlo.

---

### Requisitos Técnicos para la Importación Total de Mazos

#### A. Soporte para todos los estados de tarjeta (Paridad 1:1 con Anki)
Al importar un mazo mediante AnkiConnect (`findCards` con query `deck:"<nombre_mazo>"` sin filtro de intervalo):
1. **Tarjetas Nuevas (`type: 0` / `queue: 0`):**
   * Importar como `State.New (0)`.
   * Marcar en `word_status` como `'learning'`.
   * Mantener el orden original de introducción de tarjetas (usando el campo `due` de Anki, que en tarjetas nuevas representa su posición en la cola).
2. **Tarjetas en Aprendizaje / Reaprendizaje (`type: 1` o `3` / `queue: 1` o `3`):**
   * Importar como `State.Learning (1)` o `State.Relearning (3)`.
   * Respetar los pasos y vencimiento inmediato si correspondía repasarlas hoy.
3. **Tarjetas Jóvenes y Maduras (`type: 2` / `queue: 2`):**
   * Importar como `State.Review (2)`.
   * Conservar el intervalo real de Anki (`card.interval` / `card.ivl`).
   * Conservar el número total de repasos (`card.reps`).
   * Conservar el número de fallos (`card.lapses`).
   * **Cálculo exacto del vencimiento:** Si Anki indica que la tarjeta vence en $N$ días a partir de hoy, programar `dueDate` para dentro de $N$ días (o para hoy si ya estaba vencida), normalizada a la hora de corte (4:00 AM).

#### B. Mapeo Completo de Campos de Tarjeta
El diálogo de importación debe mapear (automáticamente o con selector de campos):
* **Palabra / Expresión:** `word` (campo kanji/palabra principal).
* **Lectura:** `reading` (campo kana o con furigana).
* **Oración / Contexto:** `sentence` (la frase donde se minó la palabra).
* **Significado / Definición:** `meaning` / `glossary`.
* **Audio:** `audio` (si incluye archivo o etiqueta `[sound:...]`).

#### C. Conservación / Migración de Parámetros FSRS
* Si la tarjeta en Anki ya tiene datos FSRS (guardados en `card.customData` o propiedades nativas FSRS):
  * Extraer `stability` y `difficulty` directamente.
* Si la tarjeta proviene de SM-2 clásico:
  * Aplicar la función de migración existente en `db.ts` (líneas 754–776):
    * `stability = interval > 0 ? interval : 2.3`
    * `difficulty = Math.max(1, Math.min(10, 5.0 + (2.5 - (ease / 1000)) * 3))`
    * `scheduled_days = interval`
    * `reps = card.reps`, `lapses = card.lapses`.

#### D. Importación offline mediante archivo `.apkg` / `.colpkg`
* Añadir soporte para subir o arrastrar un archivo `.apkg`.
* Dado que un `.apkg` es un archivo ZIP estándar que contiene una base de datos SQLite (`collection.anki2` o `collection.anki21`):
  * Descomprimir con `jszip` (o biblioteca equivalente ya presente en el proyecto).
  * Leer las tablas `notes` (campos de texto) y `cards` (estados, intervalos, vencimiento, reps, lapses) usando `sql.js` (WebAssembly SQLite) o el backend de Electron.
  * Importar el mazo completo directamente a IndexedDB sin requerir que Anki esté abierto.

---

## 4. Plan de Acción para Claude Code

1. **En `frontend/components/SrsReviewModal.tsx`**:
   - Modificar `submitGrade()`: cuando `grade === 1` o la tarjeta permanezca en aprendizaje, **reencolar la palabra al final de `dueCards`** en lugar de eliminarla con `slice(1)` hacia una pantalla de espera.
   - Implementar el *Learn Ahead Limit* (20 min) para reincorporar tarjetas de `pendingCards` inmediatamente si no quedan otras tarjetas en `dueCards`.
   - Modificar la condición de finalización de sesión para que `isFinished` solo sea `true` cuando `dueCards.length === 0` y no queden tarjetas pendientes en la sesión.
2. **En `frontend/utils/fsrs.ts` y `frontend/utils/db.ts`**:
   - Normalizar el cálculo de `dueDate` para tarjetas `Review` considerando el corte de las 4:00 AM (rollover time).
   - Ajustar el conteo de `reviewsDoneToday` para contar tarjetas únicas revisadas en el día.
3. **En `frontend/components/VocabularyModal.tsx`**:
   - Eliminar el filtro forzado `prop:ivl>=21` cuando el usuario elige importar un mazo completo para SRS.
   - Preservar todas las tarjetas nuevas (las 5335 tarjetas de la gráfica del usuario), jóvenes y maduras con sus estados reales en lugar de forzarlas todas a `known`.
   - Mapear y guardar campos completos: `reading`, `sentence`, `glossary`, `reps`, `lapses`, `interval`, `stability`, `difficulty`.
   - Añadir la opción de importar directamente un archivo `.apkg` arrastrándolo a la ventana.
