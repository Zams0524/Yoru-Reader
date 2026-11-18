import React, { useEffect, useMemo, useState } from 'react';
import { db, type DailyStatRecord } from '../../utils/db';
import { historialDeLibro, type HistorialLibro } from '../../utils/historialLibro';
import type { ShelfBook } from './libraryIndex';

/**
 * «Historial de lectura» de la ficha: los últimos 30 días de *este* libro, el ritmo al
 * que lo lees y cuánto te queda.
 *
 * La ficha ya daba el total —caracteres y tiempo—, que dice lo que has hecho pero no si
 * vas a acabar. Lo que falta es eso: cada cuánto lo abres, cuánto avanzas al día y, a
 * ese paso, qué día lo terminas.
 *
 * Los partes diarios se leen aquí y no en la ficha porque solo hacen falta para este
 * recuadro: así se leen una vez por libro abierto y no en cada repintado de la ficha.
 */

function minutos(seconds: number, es: boolean): string {
  if (seconds <= 0) return es ? 'nada' : 'nothing';
  if (seconds < 60) return es ? 'menos de un minuto' : 'under a minute';
  const horas = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (horas === 0) return `${mins} min`;
  return `${horas} h ${mins} min`;
}

function numero(value: number, es: boolean): string {
  return value.toLocaleString(es ? 'es-ES' : 'en-US');
}

function fecha(key: string | null, es: boolean): string {
  if (!key) return '—';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Date(year, month - 1, day).toLocaleDateString(es ? 'es-ES' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function BookHistoryPanel({ book, es }: { book: ShelfBook; es: boolean }) {
  const [records, setRecords] = useState<DailyStatRecord[] | null>(null);

  useEffect(() => {
    let vivo = true;
    db.getReadingStats().then((rows) => { if (vivo) setRecords(rows); });
    return () => { vivo = false; };
  }, [book.title]);

  const historial: HistorialLibro | null = useMemo(
    () => (records ? historialDeLibro(records, book, 30) : null),
    [records, book]
  );

  if (!historial) {
    return (
      <section className="yoru-stats-section">
        <h2 className="yoru-stats-title">{es ? 'Historial de lectura' : 'Reading history'}</h2>
        <div className="yoru-stats-card">
          <p className="yoru-stats-empty">{es ? 'Cargando…' : 'Loading…'}</p>
        </div>
      </section>
    );
  }

  if (historial.diasLeidos === 0) {
    return (
      <section className="yoru-stats-section">
        <h2 className="yoru-stats-title">{es ? 'Historial de lectura' : 'Reading history'}</h2>
        <div className="yoru-stats-card">
          <p className="yoru-stats-empty">
            {es
              ? 'Aún no hay días apuntados de este libro. Aparecen en cuanto leas un rato.'
              : 'No reading days recorded for this book yet. They show up as soon as you read a while.'}
          </p>
        </div>
      </section>
    );
  }

  const maxBar = Math.max(1, ...historial.dias.map((dia) => dia.seconds));
  const vacio = historial.dias.every((dia) => dia.seconds === 0 && dia.chars === 0);

  return (
    <section className="yoru-stats-section">
      <h2 className="yoru-stats-title">{es ? 'Historial de lectura' : 'Reading history'}</h2>
      <p className="yoru-stats-desc">{es ? 'Los últimos 30 días de este libro' : 'The last 30 days of this book'}</p>

      <div className="yoru-stats-card">
        {vacio ? (
          <p className="yoru-stats-empty">
            {es
              ? `Nada en los últimos 30 días. La última vez fue el ${fecha(historial.ultimaActividad, es)}.`
              : `Nothing in the last 30 days. The last time was ${fecha(historial.ultimaActividad, es)}.`}
          </p>
        ) : (
          <div
            className="yoru-stats-bars"
            role="img"
            aria-label={es ? 'Tiempo leído cada día' : 'Time read each day'}
          >
            {historial.dias.map((dia) => (
              <div
                key={dia.key}
                className="yoru-stats-bar-slot"
                title={`${fecha(dia.key, es)} · ${minutos(dia.seconds, es)}${dia.chars > 0 ? ` · ${numero(dia.chars, es)} ${es ? 'caracteres' : 'characters'}` : ''}`}
              >
                <div className="yoru-stats-bar" style={{ height: `${Math.round((dia.seconds / maxBar) * 100)}%` }}>
                  <span className="yoru-stats-bar-reading" style={{ height: '100%' }} />
                </div>
                {/* Un número cada cinco días: treinta etiquetas seguidas no se leen. */}
                <span className="yoru-stats-bar-label">
                  {Number(dia.label) % 5 === 0 ? dia.label : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="yoru-stats-figures is-row">
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Días leídos' : 'Days read'}</span>
            <strong className="yoru-stats-figure">{historial.diasLeidos}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Sesiones' : 'Sessions'}</span>
            <strong className="yoru-stats-figure">{historial.sesiones}</strong>
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Media por día' : 'Daily average'}</span>
            <strong className="yoru-stats-figure">{minutos(historial.mediaSegundos, es)}</strong>
            {historial.mediaCaracteres > 0 && (
              <span className="yoru-stats-figure-sub">
                {numero(historial.mediaCaracteres, es)} {es ? 'caracteres' : 'characters'}
              </span>
            )}
          </div>
          <div>
            <span className="yoru-stats-figure-label">{es ? 'Última vez' : 'Last activity'}</span>
            <strong className="yoru-stats-figure is-date">{fecha(historial.ultimaActividad, es)}</strong>
          </div>
        </div>
      </div>

      {/*
        Lo que queda. Es una estimación de arriba abajo —el total del libro se despeja
        del porcentaje— y por eso lleva el «aprox.» a la vista en vez de en una nota al
        pie: un número redondo invita a creérselo al carácter.
      */}
      {(historial.segundosRestantes !== null || historial.fechaFin) && (
        <div className="yoru-stats-card yoru-book-pace">
          <div className="yoru-stats-figures is-row">
            {historial.segundosRestantes !== null && (
              <div>
                <span className="yoru-stats-figure-label">{es ? 'Te queda (aprox.)' : 'Time left (approx.)'}</span>
                <strong className="yoru-stats-figure">{minutos(historial.segundosRestantes, es)}</strong>
                {historial.restantes !== null && (
                  <span className="yoru-stats-figure-sub">
                    {numero(historial.restantes, es)} {es ? 'caracteres' : 'characters'}
                  </span>
                )}
              </div>
            )}
            {historial.fechaFin && (
              <div>
                <span className="yoru-stats-figure-label">{es ? 'A este ritmo, acabas' : 'At this pace, you finish'}</span>
                <strong className="yoru-stats-figure is-date">{fecha(historial.fechaFin, es)}</strong>
                <span className="yoru-stats-figure-sub">
                  {es
                    ? `con tu media de ${numero(historial.mediaCaracteres, es)} caracteres al día`
                    : `at your average of ${numero(historial.mediaCaracteres, es)} characters a day`}
                </span>
              </div>
            )}
            {historial.ritmo !== null && (
              <div>
                <span className="yoru-stats-figure-label">{es ? 'Tu ritmo' : 'Your pace'}</span>
                <strong className="yoru-stats-figure">
                  {numero(Math.round(historial.ritmo * 3600), es)}
                </strong>
                <span className="yoru-stats-figure-sub">{es ? 'caracteres por hora' : 'characters per hour'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
