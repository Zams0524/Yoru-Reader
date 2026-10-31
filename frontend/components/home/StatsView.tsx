import React, { useEffect, useMemo, useState } from 'react';
import { db, type DailyStatRecord } from '../../utils/db';
import type { ShelfBook } from './libraryIndex';
import { bookStatus, visibleBooks } from './libraryIndex';

/**
 * Estadísticas de lectura, sobre los partes diarios que guarda `db.getReadingStats()`
 * (un registro por libro y día, con `readingTime`, `listeningTime`, `charactersRead` y
 * `sessionsCount`).
 *
 * Solo hay paneles para lo que esos datos sostienen. Quedan fuera, a propósito:
 *  - Los récords por sesión: solo agregamos por día, así que los de aquí son «día con
 *    más …», y el rótulo lo dice.
 *  - El reparto por horas del día: no guardamos la hora de cada sesión.
 */

type Lens = 'all' | 'reading' | 'listening';
type Metric = 'time' | 'chars';
type Span = 'week' | 'month' | 'year';

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(date: Date): string {
  return date.toLocaleDateString('sv').slice(0, 10);
}

function parseYmd(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Minutos redondeados, en el formato corto de las tarjetas. */
function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

function secondsOf(record: DailyStatRecord, lens: Lens): number {
  const reading = record.readingTime || 0;
  const listening = record.listeningTime || 0;
  if (lens === 'reading') return reading;
  if (lens === 'listening') return listening;
  return reading + listening;
}

/** Los caracteres son siempre de lectura: escuchar no cuenta caracteres. */
function charsOf(record: DailyStatRecord, lens: Lens): number {
  return lens === 'listening' ? 0 : record.charactersRead || 0;
}

interface DayTotals {
  seconds: number;
  readingSeconds: number;
  listeningSeconds: number;
  chars: number;
  sessions: number;
}

function totalsByDay(records: DailyStatRecord[], lens: Lens): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const record of records) {
    if (!record?.dateKey) continue;
    const entry = map.get(record.dateKey) || {
      seconds: 0, readingSeconds: 0, listeningSeconds: 0, chars: 0, sessions: 0,
    };
    entry.seconds += secondsOf(record, lens);
    entry.readingSeconds += record.readingTime || 0;
    entry.listeningSeconds += record.listeningTime || 0;
    entry.chars += charsOf(record, lens);
    entry.sessions += record.sessionsCount || 0;
    map.set(record.dateKey, entry);
  }
  return map;
}

/** Un día cuenta como activo si tiene tiempo o caracteres bajo la lente elegida. */
function isActive(totals: DayTotals): boolean {
  return totals.seconds > 0 || totals.chars > 0;
}

function streaks(days: Map<string, DayTotals>): { current: number; best: number; active: number } {
  const keys = [...days.entries()].filter(([, totals]) => isActive(totals)).map(([key]) => key).sort();
  if (!keys.length) return { current: 0, best: 0, active: 0 };

  let best = 1;
  let run = 1;
  for (let i = 1; i < keys.length; i += 1) {
    const gap = Math.round((parseYmd(keys[i]).getTime() - parseYmd(keys[i - 1]).getTime()) / DAY_MS);
    run = gap === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  // La racha actual solo sigue viva si el último día activo es hoy o ayer.
  const last = keys[keys.length - 1];
  const sinceLast = Math.round((parseYmd(ymd(new Date())).getTime() - parseYmd(last).getTime()) / DAY_MS);
  let current = 0;
  if (sinceLast <= 1) {
    current = 1;
    for (let i = keys.length - 1; i > 0; i -= 1) {
      const gap = Math.round((parseYmd(keys[i]).getTime() - parseYmd(keys[i - 1]).getTime()) / DAY_MS);
      if (gap !== 1) break;
      current += 1;
    }
  }
  return { current, best, active: keys.length };
}

function spanStart(span: Span, today: Date): Date {
  const start = new Date(today);
  if (span === 'week') start.setDate(start.getDate() - 6);
  else if (span === 'month') start.setDate(start.getDate() - 29);
  else start.setDate(start.getDate() - 364);
  start.setHours(0, 0, 0, 0);
  return start;
}

export default function StatsView({ books, es }: { books: ShelfBook[]; es: boolean }) {
  const [records, setRecords] = useState<DailyStatRecord[] | null>(null);
  const [lens, setLens] = useState<Lens>('all');
  const [metric, setMetric] = useState<Metric>('time');
  const [span, setSpan] = useState<Span>('week');

  useEffect(() => {
    let alive = true;
    db.getReadingStats()
      .then((rows) => { if (alive) setRecords(rows); })
      .catch(() => { if (alive) setRecords([]); });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => records || [], [records]);
  const days = useMemo(() => totalsByDay(rows, lens), [rows, lens]);
  const streak = useMemo(() => streaks(days), [days]);

  const today = ymd(new Date());
  const todayTotals = days.get(today) || {
    seconds: 0, readingSeconds: 0, listeningSeconds: 0, chars: 0, sessions: 0,
  };

  // ¿Se ha apuntado alguna escucha alguna vez? Si no, las lentes de audio no tienen
  // nada que enseñar y es más honesto no ofrecerlas.
  const hasListening = useMemo(() => rows.some((row) => (row.listeningTime || 0) > 0), [rows]);

  const bestDay = useMemo(() => {
    let key = '';
    let value = 0;
    for (const [day, totals] of days) {
      if (totals.seconds > value) { value = totals.seconds; key = day; }
    }
    return { key, value };
  }, [days]);

  const periodRows = useMemo(() => {
    const from = ymd(spanStart(span, new Date()));
    return rows.filter((row) => row.dateKey >= from && row.dateKey <= today);
  }, [rows, span, today]);

  const periodDays = useMemo(() => totalsByDay(periodRows, lens), [periodRows, lens]);

  const periodTotals = useMemo(() => {
    let seconds = 0; let chars = 0; let sessions = 0; let active = 0;
    for (const totals of periodDays.values()) {
      seconds += totals.seconds; chars += totals.chars; sessions += totals.sessions;
      if (isActive(totals)) active += 1;
    }
    return { seconds, chars, sessions, active };
  }, [periodDays]);

  const periodBooks = useMemo(() => {
    const map = new Map<string, { seconds: number; chars: number }>();
    for (const row of periodRows) {
      const entry = map.get(row.title) || { seconds: 0, chars: 0 };
      entry.seconds += secondsOf(row, lens);
      entry.chars += charsOf(row, lens);
      map.set(row.title, entry);
    }
    return [...map.entries()]
      .filter(([, value]) => value.seconds > 0 || value.chars > 0)
      .sort((a, b) => b[1].seconds - a[1].seconds || b[1].chars - a[1].chars);
  }, [periodRows, lens]);

  /** Barras del periodo: un punto por día, con su reparto lectura / escucha. */
  const bars = useMemo(() => {
    const out: { key: string; label: string; reading: number; listening: number; chars: number }[] = [];
    const start = spanStart(span, new Date());
    const count = span === 'week' ? 7 : span === 'month' ? 30 : 364;
    const step = span === 'year' ? 7 : 1;
    for (let i = 0; i < count; i += step) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      let reading = 0; let listening = 0; let chars = 0;
      for (let j = 0; j < step; j += 1) {
        const inner = new Date(date);
        inner.setDate(inner.getDate() + j);
        const totals = days.get(ymd(inner));
        if (!totals) continue;
        reading += totals.readingSeconds;
        listening += totals.listeningSeconds;
        chars += totals.chars;
      }
      out.push({
        key: ymd(date),
        label: span === 'week'
          ? date.toLocaleDateString(es ? 'es' : 'en', { weekday: 'short' })
          : date.toLocaleDateString(es ? 'es' : 'en', { day: 'numeric', month: 'short' }),
        reading, listening, chars,
      });
    }
    return out;
  }, [days, span, es]);

  /** El día de la semana con más tiempo acumulado. Sale del día; la hora no la guardamos. */
  const strongestWeekday = useMemo(() => {
    const totals = new Array(7).fill(0) as number[];
    for (const [key, value] of days) totals[parseYmd(key).getDay()] += value.seconds;
    let index = -1; let best = 0;
    totals.forEach((value, i) => { if (value > best) { best = value; index = i; } });
    if (index < 0) return null;
    const sample = new Date(2024, 0, 7 + index); // 7 de enero de 2024 fue domingo
    return { name: sample.toLocaleDateString(es ? 'es' : 'en', { weekday: 'long' }), seconds: best, totals };
  }, [days, es]);

  const bestDays = useMemo(() => {
    let timeKey = ''; let timeValue = 0;
    let listenKey = ''; let listenValue = 0;
    let charsKey = ''; let charsValue = 0;
    for (const [key, totals] of days) {
      if (totals.readingSeconds > timeValue) { timeValue = totals.readingSeconds; timeKey = key; }
      if (totals.listeningSeconds > listenValue) { listenValue = totals.listeningSeconds; listenKey = key; }
      if (totals.chars > charsValue) { charsValue = totals.chars; charsKey = key; }
    }
    return { timeKey, timeValue, listenKey, listenValue, charsKey, charsValue };
  }, [days]);

  const finished = useMemo(
    () => visibleBooks(books).filter((book) => bookStatus(book) === 'completed').length,
    [books]
  );

  const allTime = useMemo(() => {
    let seconds = 0; let sessions = 0;
    for (const totals of days.values()) { seconds += totals.seconds; sessions += totals.sessions; }
    return { seconds, sessions };
  }, [days]);

  const fmtDate = (key: string) =>
    key ? parseYmd(key).toLocaleDateString(es ? 'es' : 'en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  if (records === null) {
    return (
      <div className="app-section-loading" role="status" aria-live="polite">
        <span className="app-section-loading-indicator" />
        {es ? 'Cargando estadísticas…' : 'Loading statistics…'}
      </div>
    );
  }

  const maxBar = Math.max(
    1,
    ...bars.map((bar) => (metric === 'time' ? bar.reading + bar.listening : bar.chars))
  );

  return (
    <div className="yoru-stats">
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Estadísticas' : 'Statistics'}</h1>
          <div className="yoru-view-sub">{es ? 'Tu lectura, día a día.' : 'Your reading, day by day.'}</div>
        </div>
        {hasListening && (
          <div className="yoru-chip-row" style={{ marginBottom: 0 }}>
            {([['all', es ? 'Todo' : 'All'], ['reading', es ? 'Lectura' : 'Reading'], ['listening', es ? 'Escucha' : 'Listening']] as [Lens, string][]).map(
              ([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`yoru-chip${lens === id ? ' active' : ''}`}
                  onClick={() => setLens(id)}
                >
                  {label}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Hoy, rachas y días activos */}
      <section className="yoru-stats-card yoru-stats-today">
        <div className="yoru-stats-dial">
          <svg viewBox="0 0 200 118" role="img" aria-label={es ? 'Tiempo de hoy' : "Today's time"}>
            <path d="M16 110 A84 84 0 0 1 184 110" fill="none" stroke="var(--border-light)" strokeWidth="16" strokeLinecap="round" />
            {todayTotals.seconds > 0 && (
              <path
                d="M16 110 A84 84 0 0 1 184 110"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="16"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={100}
                strokeDashoffset={100 - Math.min(100, (todayTotals.seconds / 3600) * 100)}
              />
            )}
          </svg>
          <div className="yoru-stats-dial-text">
            <span className="yoru-stats-dial-label">{es ? 'Hoy' : 'Today'}</span>
            <strong className="yoru-stats-dial-value">{minutes(todayTotals.seconds)}</strong>
            <span className="yoru-stats-dial-sub">
              {todayTotals.chars.toLocaleString(es ? 'es' : 'en')} {es ? 'caracteres' : 'characters'}
            </span>
          </div>
          {hasListening && (
            <div className="yoru-stats-split">
              <span><i className="yoru-dot is-reading" />{es ? 'Lectura' : 'Reading'} · {minutes(todayTotals.readingSeconds)}</span>
              <span><i className="yoru-dot is-listening" />{es ? 'Escucha' : 'Listening'} · {minutes(todayTotals.listeningSeconds)}</span>
            </div>
          )}
        </div>

        <div className="yoru-stats-figures">
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Racha actual' : 'Current streak'}</span>
            <strong className="yoru-stats-figure">{streak.current} {es ? (streak.current === 1 ? 'día' : 'días') : streak.current === 1 ? 'day' : 'days'}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Mejor racha' : 'Best streak'}</span>
            <strong className="yoru-stats-figure">{streak.best} {es ? (streak.best === 1 ? 'día' : 'días') : streak.best === 1 ? 'day' : 'days'}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Días activos' : 'Active days'}</span>
            <strong className="yoru-stats-figure">{streak.active}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Mejor día' : 'Best day'}</span>
            <strong className="yoru-stats-figure">{minutes(bestDay.value)}</strong>
            <span className="yoru-stats-figure-sub">{fmtDate(bestDay.key)}</span>
          </div>
        </div>
      </section>

      {/* Mapa de calor del último año */}
      <section className="yoru-stats-section">
        <h2 className="yoru-stats-title">{es ? 'Actividad' : 'Activity'}</h2>
        <p className="yoru-stats-desc">{es ? 'Tu último año, día a día' : 'Your last year, day by day'}</p>
        <div className="yoru-stats-card">
          <Heatmap days={days} es={es} />
        </div>
      </section>

      {/* Tendencia */}
      <section className="yoru-stats-section">
        <div className="yoru-stats-head-row">
          <h2 className="yoru-stats-title">{es ? 'Tendencia' : 'Trend'}</h2>
          <div className="yoru-stats-switches">
            <div className="yoru-chip-row" style={{ marginBottom: 0 }}>
              <button type="button" className={`yoru-chip${metric === 'time' ? ' active' : ''}`} onClick={() => setMetric('time')}>{es ? 'Tiempo' : 'Time'}</button>
              <button type="button" className={`yoru-chip${metric === 'chars' ? ' active' : ''}`} onClick={() => setMetric('chars')}>{es ? 'Caracteres' : 'Characters'}</button>
            </div>
            <div className="yoru-chip-row" style={{ marginBottom: 0 }}>
              <button type="button" className={`yoru-chip${span === 'week' ? ' active' : ''}`} onClick={() => setSpan('week')}>{es ? 'Semana' : 'Week'}</button>
              <button type="button" className={`yoru-chip${span === 'month' ? ' active' : ''}`} onClick={() => setSpan('month')}>{es ? 'Mes' : 'Month'}</button>
              <button type="button" className={`yoru-chip${span === 'year' ? ' active' : ''}`} onClick={() => setSpan('year')}>{es ? 'Año' : 'Year'}</button>
            </div>
          </div>
        </div>

        <div className="yoru-stats-card">
          <div className="yoru-stats-bars" role="img" aria-label={es ? 'Tendencia del periodo' : 'Trend for the period'}>
            {bars.map((bar) => {
              const value = metric === 'time' ? bar.reading + bar.listening : bar.chars;
              const height = Math.round((value / maxBar) * 100);
              const readingShare = metric === 'time' && value > 0 ? (bar.reading / value) * 100 : 100;
              return (
                <div
                  key={bar.key}
                  className="yoru-stats-bar-slot"
                  title={`${bar.label} · ${metric === 'time' ? minutes(value) : value.toLocaleString(es ? 'es' : 'en')}`}
                >
                  <div className="yoru-stats-bar" style={{ height: `${height}%` }}>
                    <span className="yoru-stats-bar-reading" style={{ height: `${readingShare}%` }} />
                  </div>
                  {bars.length <= 31 && <span className="yoru-stats-bar-label">{bar.label}</span>}
                </div>
              );
            })}
          </div>
          <div className="yoru-stats-legend">
            <span><i className="yoru-dot is-reading" />{es ? 'Lectura' : 'Reading'}</span>
            {hasListening && <span><i className="yoru-dot is-listening" />{es ? 'Escucha' : 'Listening'}</span>}
          </div>

          <div className="yoru-stats-figures is-row">
            <div>
              <span className="yoru-stats-figure-label">{es ? 'Tiempo total' : 'Total time'}</span>
              <strong className="yoru-stats-figure">{minutes(periodTotals.seconds)}</strong>
            </div>
            <div>
              <span className="yoru-stats-figure-label">{es ? 'Días activos' : 'Active days'}</span>
              <strong className="yoru-stats-figure">{periodTotals.active}</strong>
            </div>
            <div>
              <span className="yoru-stats-figure-label">{es ? 'Caracteres' : 'Characters'}</span>
              <strong className="yoru-stats-figure">{periodTotals.chars.toLocaleString(es ? 'es' : 'en')}</strong>
            </div>
            <div>
              <span className="yoru-stats-figure-label">{es ? 'Sesiones' : 'Sessions'}</span>
              <strong className="yoru-stats-figure">{periodTotals.sessions}</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Libros del periodo */}
      <section className="yoru-stats-section">
        <h2 className="yoru-stats-title">{es ? 'Libros' : 'Books'}</h2>
        <div className="yoru-stats-card">
          {periodBooks.length === 0 ? (
            <p className="yoru-stats-empty">
              {es ? 'No leíste ni escuchaste nada en este período.' : 'You did not read or listen to anything in this period.'}
            </p>
          ) : (
            <ul className="yoru-stats-books">
              {periodBooks.map(([title, value]) => (
                <li key={title}>
                  <span className="yoru-stats-book-title">{title}</span>
                  <span className="yoru-stats-book-value">
                    {minutes(value.seconds)} · {value.chars.toLocaleString(es ? 'es' : 'en')} {es ? 'caracteres' : 'characters'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Récords: por día, porque solo agregamos por día */}
      <section className="yoru-stats-section">
        <h2 className="yoru-stats-title">{es ? 'Récords' : 'Records'}</h2>
        <div className="yoru-stats-grid">
          <div className="yoru-stats-card">
            <span className="yoru-stats-figure-label">{es ? 'Día con más lectura' : 'Most reading in a day'}</span>
            <strong className="yoru-stats-figure">{minutes(bestDays.timeValue)}</strong>
            <span className="yoru-stats-figure-sub">{fmtDate(bestDays.timeKey)}</span>
          </div>
          {hasListening && (
            <div className="yoru-stats-card">
              <span className="yoru-stats-figure-label">{es ? 'Día con más escucha' : 'Most listening in a day'}</span>
              <strong className="yoru-stats-figure">{minutes(bestDays.listenValue)}</strong>
              <span className="yoru-stats-figure-sub">{fmtDate(bestDays.listenKey)}</span>
            </div>
          )}
          <div className="yoru-stats-card">
            <span className="yoru-stats-figure-label">{es ? 'Día con más caracteres' : 'Most characters in a day'}</span>
            <strong className="yoru-stats-figure">{bestDays.charsValue.toLocaleString(es ? 'es' : 'en')}</strong>
            <span className="yoru-stats-figure-sub">{fmtDate(bestDays.charsKey)}</span>
          </div>
        </div>
      </section>

      {/* Hábitos: solo el día de la semana, que es lo que los datos sostienen */}
      {strongestWeekday && (
        <section className="yoru-stats-section">
          <h2 className="yoru-stats-title">{es ? 'Hábitos' : 'Habits'}</h2>
          <div className="yoru-stats-card">
            <p className="yoru-stats-lead">
              {es ? 'Tu día más fuerte: ' : 'Your strongest day: '}
              <strong>{strongestWeekday.name}</strong>
            </p>
            <div className="yoru-stats-weekdays">
              {strongestWeekday.totals.map((value, index) => {
                const max = Math.max(1, ...strongestWeekday.totals);
                const day = new Date(2024, 0, 7 + index);
                return (
                  <div key={index} className="yoru-stats-weekday">
                    <div className="yoru-stats-weekday-track">
                      <span style={{ height: `${Math.round((value / max) * 100)}%` }} />
                    </div>
                    <span className="yoru-stats-bar-label">
                      {day.toLocaleDateString(es ? 'es' : 'en', { weekday: 'narrow' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Totales de siempre */}
      <section className="yoru-stats-section">
        <div className="yoru-stats-figures is-row">
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Desde siempre' : 'All time'}</span>
            <strong className="yoru-stats-figure">{minutes(allTime.seconds)}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Sesiones' : 'Sessions'}</span>
            <strong className="yoru-stats-figure">{allTime.sessions}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Días activos' : 'Active days'}</span>
            <strong className="yoru-stats-figure">{streak.active}</strong>
          </div>
          <div>
            {/* Total de libros marcados como terminados: no sabemos cuándo se terminó cada uno. */}
            <span className="yoru-stats-figure-label">{es ? 'Libros terminados' : 'Finished books'}</span>
            <strong className="yoru-stats-figure">{finished}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Mapa de calor del último año: una columna por semana, una fila por día. */
function Heatmap({ days, es }: { days: Map<string, DayTotals>; es: boolean }) {
  const { weeks, months, active, max } = useMemo(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 363);
    start.setDate(start.getDate() - start.getDay()); // la primera columna empieza en domingo

    const cells: { key: string; value: number; date: Date }[] = [];
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const key = ymd(date);
      cells.push({ key, value: days.get(key)?.seconds || 0, date: new Date(date) });
    }

    const grouped: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) grouped.push(cells.slice(i, i + 7));

    const labels: { index: number; label: string }[] = [];
    let lastMonth = -1;
    grouped.forEach((week, index) => {
      const first = week[0];
      if (first && first.date.getMonth() !== lastMonth) {
        lastMonth = first.date.getMonth();
        // Se salta la etiqueta si cae pegada a la anterior: dos meses juntos se leen
        // como una sola palabra («octnov»).
        const previous = labels[labels.length - 1];
        if (!previous || index - previous.index >= 3) {
          labels.push({ index, label: first.date.toLocaleDateString(es ? 'es' : 'en', { month: 'short' }) });
        }
      }
    });

    return {
      weeks: grouped,
      months: labels,
      active: cells.filter((cell) => cell.value > 0).length,
      max: Math.max(1, ...cells.map((cell) => cell.value)),
    };
  }, [days, es]);

  const level = (value: number) => (value <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4)));

  return (
    <div className="yoru-heatmap">
      <div className="yoru-heatmap-months">
        {months.map((month) => (
          <span key={`${month.index}-${month.label}`} style={{ gridColumn: month.index + 1 }}>{month.label}</span>
        ))}
      </div>
      <div className="yoru-heatmap-grid">
        {weeks.map((week, index) => (
          <div key={index} className="yoru-heatmap-week">
            {week.map((cell) => (
              <i
                key={cell.key}
                className="yoru-heatmap-cell"
                data-level={level(cell.value)}
                title={`${cell.date.toLocaleDateString(es ? 'es' : 'en', { weekday: 'short', day: 'numeric', month: 'short' })} · ${cell.value > 0 ? minutes(cell.value) : es ? 'sin actividad' : 'no activity'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="yoru-heatmap-foot">
        <span>
          {active} {es ? (active === 1 ? 'día con actividad este año' : 'días con actividad este año') : active === 1 ? 'day with activity this year' : 'days with activity this year'}
        </span>
        <span className="yoru-heatmap-scale">
          {es ? 'Menos' : 'Less'}
          {[0, 1, 2, 3, 4].map((value) => <i key={value} className="yoru-heatmap-cell" data-level={value} />)}
          {es ? 'Más' : 'More'}
        </span>
      </div>
    </div>
  );
}
