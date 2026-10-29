import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, Flame, BookOpen, RefreshCw } from 'lucide-react';
import { isPhoneUI } from '../utils/platform';

interface Book {
  id: number;
  title: string;
  cover?: string;
  author?: string;
}

interface DbStatistic {
  title: string;
  dateKey: string;
  charactersRead: number;
  readingTime: number; // in seconds
  sessionsCount?: number;
  lastStatisticModified: number;
}

interface ProgressDashboardProps {
  books: Book[];
  lang?: string;
  excludedBookIds?: string[];
}

export default function ProgressDashboard({ books, lang = 'en', excludedBookIds = [] }: ProgressDashboardProps) {
  const [dbStats, setDbStats] = useState<DbStatistic[]>([]);
  const [timeWindow, setTimeWindow] = useState<'7D' | '30D' | '90D' | 'All'>('30D');
  const [hoveredDay, setHoveredDay] = useState<{ dateStr: string; time: number; chars: number } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const filteredDbStats = useMemo(() => {
    if (!excludedBookIds || excludedBookIds.length === 0) return dbStats;
    const excludedTitles = new Set(
      books.filter((b) => excludedBookIds.includes(String(b.id))).map((b) => b.title)
    );
    return dbStats.filter((s) => !excludedTitles.has(s.title));
  }, [dbStats, books, excludedBookIds]);

  const t = {
    progress: lang === 'es' ? 'Progreso' : 'Progress',
    subtitle: lang === 'es' ? 'Historial de sesiones y totales de lectura diaria.' : 'Session history and daily reading totals.',
    sessionSync: lang === 'es' ? 'Sincronización de sesión' : 'Session sync',
    sessionSyncDesc: lang === 'es' ? 'Sincronización manual de cuenta para el historial de lectura y progreso.' : 'Manual account sync for reading history and progress stats.',
    signInSync: lang === 'es' ? 'Iniciar sesión para sincronizar' : 'Sign in to sync sessions.',
    today: lang === 'es' ? 'HOY' : 'TODAY',
    todaySpeed: lang === 'es' ? 'VELOCIDAD HOY' : 'TODAY SPEED',
    streak: lang === 'es' ? 'RACHA' : 'STREAK',
    chars: lang === 'es' ? 'caracteres' : 'chars',
    charSpeed: lang === 'es' ? 'caracteres/h' : 'chars/h',
    sessions: lang === 'es' ? 'sesiones' : 'sessions',
    session: lang === 'es' ? 'sesión' : 'session',
    consecutiveDays: lang === 'es' ? 'Días de lectura consecutivos' : 'Consecutive reading days',
    heatmap: lang === 'es' ? 'Mapa de calor' : 'Heatmap',
    heatmapDesc: lang === 'es' ? 'Tiempo de lectura diario a lo largo de la ventana seleccionada.' : 'Daily reading time across the selected window.',
    recentSessions: lang === 'es' ? 'Sesiones recientes' : 'Recent sessions',
    noSessions: lang === 'es'
      ? 'Aún no hay sesiones registradas. En el lector, abre «Sesión de lectura» y pulsa «Iniciar sesión» para medir tu lectura.'
      : 'No sessions yet. In the reader, open "Reading session" and tap "Start session" to track your reading.',
    byBook: lang === 'es' ? 'Por libro' : 'By book',
    bookTotalsDesc: lang === 'es' ? 'Los totales de cada libro aparecerán aquí.' : 'Book totals appear after you finish or pause sessions.',
    shown: lang === 'es' ? 'mostrados' : 'shown',
    allTime: lang === 'es' ? 'Todo el tiempo' : 'All Time',
    windowAll: lang === 'es' ? 'Todo' : 'All',
    windowDays: lang === 'es' ? 'días' : 'days',
    windowTime: (n: string) => (lang === 'es' ? `${n} DÍAS` : `${n} DAYS`),
    timeWindowLabel: lang === 'es' ? 'Periodo' : 'Time window',
    days: lang === 'es' ? 'días' : 'days',
    day: lang === 'es' ? 'día' : 'day',
  };

  const loadStatistics = async () => {
    setLoading(true);
    try {
      const dbStatsList = await new Promise<DbStatistic[]>((resolve) => {
        const request = indexedDB.open('books');
        request.onsuccess = (e: any) => {
          const dbInstance = e.target.result;
          if (!dbInstance.objectStoreNames.contains('statistic')) {
            resolve([]);
            return;
          }
          const tx = dbInstance.transaction('statistic', 'readonly');
          const store = tx.objectStore('statistic');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
      setDbStats(dbStatsList);
    } catch (err) {
      console.error('Failed to load db statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatistics();
  }, []);

  // Format YYYY-MM-DD local date string
  const todayStr = useMemo(() => new Date().toLocaleDateString('sv').slice(0, 10), []);

  // 1. TODAY'S TOTALS
  const todayStats = useMemo(() => filteredDbStats.filter((s) => s.dateKey === todayStr), [filteredDbStats, todayStr]);
  const todayChars = useMemo(() => todayStats.reduce((acc, s) => acc + (s.charactersRead || 0), 0), [todayStats]);
  const todaySeconds = useMemo(() => todayStats.reduce((acc, s) => acc + (s.readingTime || 0), 0), [todayStats]);

  const formatDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return [hrs, mins, secs].map((v) => v.toString().padStart(2, '0')).join(':');
  };

  // Headline totals read better as "1 h 05 min" than as a 00:00:00 stopwatch.
  const formatCompactDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hrs > 0) return `${hrs} h ${mins.toString().padStart(2, '0')} min`;
    return `${mins} min`;
  };

  const todayTimeStr = useMemo(() => formatCompactDuration(todaySeconds), [todaySeconds]);
  const todaySpeedVal = useMemo(() => (todaySeconds >= 10 && todayChars > 0 ? Math.round((todayChars / todaySeconds) * 3600) : 0), [todayChars, todaySeconds]);
  const todaySessionsCount = useMemo(() => todayStats.reduce((total, stat) => {
    if (typeof stat.sessionsCount === 'number') return total + stat.sessionsCount;
    return total + (stat.charactersRead > 0 || stat.readingTime > 0 ? 1 : 0);
  }, 0), [todayStats]);

  // 2. STREAK CALCULATION
  const streakDays = useMemo(() => {
    const readDates = new Set(filteredDbStats.filter((s) => (s.charactersRead || 0) > 0 || (s.readingTime || 0) > 0).map((s) => s.dateKey));
    if (readDates.size === 0) return 0;

    let streak = 0;
    const checkDate = new Date();
    let checkDateStr = checkDate.toLocaleDateString('sv').slice(0, 10);

    // If no reading today, allow check starting from yesterday
    if (!readDates.has(checkDateStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
      checkDateStr = checkDate.toLocaleDateString('sv').slice(0, 10);
    }

    while (readDates.has(checkDateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
      checkDateStr = checkDate.toLocaleDateString('sv').slice(0, 10);
    }
    return streak;
  }, [filteredDbStats]);

  // 3. TIME WINDOW DATA FILTERING
  const windowDaysLimit = useMemo(() => {
    if (timeWindow === '7D') return 7;
    if (timeWindow === '30D') return 30;
    if (timeWindow === '90D') return 90;
    return 365; // 'All' defaults to 1 year calendar
  }, [timeWindow]);

  const windowStartDateStr = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - (windowDaysLimit - 1));
    return start.toLocaleDateString('sv').slice(0, 10);
  }, [windowDaysLimit]);

  const windowStats = useMemo(() => {
    if (timeWindow === 'All') return filteredDbStats;
    return filteredDbStats.filter((s) => s.dateKey >= windowStartDateStr && s.dateKey <= todayStr);
  }, [filteredDbStats, timeWindow, windowStartDateStr, todayStr]);

  const windowChars = useMemo(() => windowStats.reduce((acc, s) => acc + (s.charactersRead || 0), 0), [windowStats]);
  const windowSeconds = useMemo(() => windowStats.reduce((acc, s) => acc + (s.readingTime || 0), 0), [windowStats]);
  const windowTimeStr = useMemo(() => formatCompactDuration(windowSeconds), [windowSeconds]);

  // 4. HEATMAP GRID CELL GENERATION
  const heatmapCells = useMemo(() => {
    const cells = [];
    const end = new Date();
    const start = new Date();
    
    if (timeWindow === 'All') {
      // Show full year calendar grid (53 columns of 7 days)
      const startOfYear = new Date(end.getFullYear(), 0, 1);
      const dayOfWeek = startOfYear.getDay();
      const startOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setTime(startOfYear.getTime() + startOffset * 24 * 60 * 60 * 1000);
      
      const totalDays = 53 * 7;
      for (let i = 0; i < totalDays; i++) {
        const currentDate = new Date(start);
        currentDate.setDate(start.getDate() + i);
        const dateKey = currentDate.toLocaleDateString('sv').slice(0, 10);
        
        const dayStats = filteredDbStats.filter((s) => s.dateKey === dateKey);
        const chars = dayStats.reduce((acc, s) => acc + (s.charactersRead || 0), 0);
        const time = dayStats.reduce((acc, s) => acc + (s.readingTime || 0), 0);
        
        cells.push({ dateKey, chars, time });
      }
    } else {
      // Show exactly 7, 30 or 90 days grid
      start.setDate(end.getDate() - (windowDaysLimit - 1));
      for (let i = 0; i < windowDaysLimit; i++) {
        const currentDate = new Date(start);
        currentDate.setDate(start.getDate() + i);
        const dateKey = currentDate.toLocaleDateString('sv').slice(0, 10);
        
        const dayStats = filteredDbStats.filter((s) => s.dateKey === dateKey);
        const chars = dayStats.reduce((acc, s) => acc + (s.charactersRead || 0), 0);
        const time = dayStats.reduce((acc, s) => acc + (s.readingTime || 0), 0);
        
        cells.push({ dateKey, chars, time });
      }
    }
    return cells;
  }, [filteredDbStats, timeWindow, windowDaysLimit]);

  const getCellColor = (chars: number) => {
    if (chars === 0) return 'var(--border-light)';
    if (chars < 500) return 'rgba(242, 200, 102, 0.18)';
    if (chars < 1500) return 'rgba(242, 200, 102, 0.45)';
    if (chars < 3000) return 'rgba(242, 200, 102, 0.75)';
    return '#f2c866';
  };

  // 5. RECENT SESSIONS LIST
  const recentSessionsList = useMemo(() => {
    const list = filteredDbStats
      .filter((s) => s.charactersRead > 0 || s.readingTime > 0)
      .map((s) => {
        const bookObj = books.find((b) => b.title === s.title);
        return {
          title: s.title,
          cover: bookObj?.cover,
          author: bookObj?.author || (lang === 'es' ? 'Desconocido' : 'Unknown'),
          dateKey: s.dateKey,
          chars: s.charactersRead,
          time: s.readingTime,
          modified: s.lastStatisticModified,
        };
      })
      .sort((a, b) => b.modified - a.modified || b.dateKey.localeCompare(a.dateKey));
    return list.slice(0, 10);
  }, [filteredDbStats, books, lang]);

  // 6. BY BOOK AGGREGATION LIST
  const byBookList = useMemo(() => {
    const map = new Map<string, { chars: number; time: number }>();
    filteredDbStats.forEach((s) => {
      const cur = map.get(s.title) || { chars: 0, time: 0 };
      map.set(s.title, {
        chars: cur.chars + (s.charactersRead || 0),
        time: cur.time + (s.readingTime || 0),
      });
    });

    const list = Array.from(map.entries())
      .map(([title, val]) => {
        const bookObj = books.find((b) => b.title === title);
        return {
          title,
          cover: bookObj?.cover,
          author: bookObj?.author || (lang === 'es' ? 'Desconocido' : 'Unknown'),
          chars: val.chars,
          time: val.time,
        };
      })
      .sort((a, b) => b.chars - a.chars);
    return list;
  }, [filteredDbStats, books, lang]);

  return (
    <div className="progress-dashboard-root" style={{ padding: '16px', maxWidth: '1200px', margin: '0 auto', color: 'var(--text-main)', background: 'transparent', minHeight: '100vh', fontFamily: "'Outfit', 'Inter', sans-serif", boxSizing: 'border-box' }}>
      {/* HEADER SECTION */}
      <div className="progress-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div>
          <h1 className="progress-page-heading" style={{ fontSize: '1.75rem', fontWeight: 850, margin: 0, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>{t.progress}</h1>
          <p className="progress-page-subtitle" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>{t.subtitle}</p>
        </div>

        {/* TIME WINDOW PICKER */}
        <div className="progress-window-picker" role="radiogroup" aria-label={t.timeWindowLabel}>
          {(['7D', '30D', '90D', 'All'] as const).map((opt) => {
            const active = timeWindow === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? 'is-active' : ''}
                onClick={() => setTimeWindow(opt)}
              >
                {opt === 'All' ? t.windowAll : `${parseInt(opt, 10)} ${t.windowDays}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* GRID OF 4 CARDS */}
      <div className="progress-kpi-grid">
        {/* CARD 1: TODAY */}
        <div className="progress-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            <Clock size={14} style={{ color: 'var(--primary)' }} />
            <span>{t.today}</span>
          </div>
          <div className="progress-kpi-value">{todayTimeStr}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {todayChars.toLocaleString()} <span style={{ opacity: 0.6 }}>{t.chars}</span>
          </div>
        </div>

        {/* CARD 2: TODAY SPEED */}
        <div className="progress-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            <RefreshCw size={14} style={{ color: 'var(--primary)' }} />
            <span>{t.todaySpeed}</span>
          </div>
          <div className="progress-kpi-value">
            {todaySpeedVal} <span style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 700 }}>{t.charSpeed}</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {todaySessionsCount} <span style={{ opacity: 0.6 }}>{todaySessionsCount === 1 ? t.session : t.sessions}</span>
          </div>
        </div>

        {/* CARD 3: STREAK */}
        <div className="progress-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            <Flame size={14} style={{ color: 'var(--primary)' }} />
            <span>{t.streak}</span>
          </div>
          <div className="progress-kpi-value">
            {streakDays} <span style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 700 }}>{streakDays === 1 ? t.day : t.days}</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.consecutiveDays}</div>
        </div>

        {/* CARD 4: WINDOW TIME */}
        <div className="progress-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            <Calendar size={14} style={{ color: 'var(--primary)' }} />
            <span>{timeWindow === 'All' ? t.allTime.toUpperCase() : t.windowTime(String(parseInt(timeWindow, 10)))}</span>
          </div>
          <div className="progress-kpi-value">{windowTimeStr}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {windowChars.toLocaleString()} <span style={{ opacity: 0.6 }}>{t.chars}</span>
          </div>
        </div>
      </div>

      {/* HEATMAP PANEL */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>{t.heatmap}</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.heatmapDesc}</p>
          </div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', padding: '4px 10px', background: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: '6px' }}>
            {hoveredDay ? (
              `${hoveredDay.dateStr}: ${formatDuration(hoveredDay.time)} — ${hoveredDay.chars.toLocaleString()} ${t.chars}`
            ) : (
              isPhoneUI()
                ? (lang === 'es' ? 'Toca un día para ver el detalle' : 'Tap a day for details')
                : (lang === 'es' ? 'Pasa el cursor sobre un día para ver el detalle' : 'Hover a day for details')
            )}
          </div>
        </div>

        {/* Heatmap Grid rendering */}
        <div style={{ overflowX: 'auto', display: 'flex', gap: '2px', padding: '8px 0', WebkitOverflowScrolling: 'touch' }}>
          {timeWindow === 'All' ? (
            // Full 53-week layout columns
            <div style={{ display: 'flex', gap: '3px' }}>
              {Array.from({ length: 53 }).map((_, wIdx) => (
                <div key={wIdx} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {Array.from({ length: 7 }).map((_, dIdx) => {
                    const cellIdx = wIdx * 7 + dIdx;
                    const cell = heatmapCells[cellIdx];
                    if (!cell) return null;
                    return (
                      <div
                        key={dIdx}
                        onClick={() => setHoveredDay({ dateStr: cell.dateKey, time: cell.time, chars: cell.chars })}
                        onMouseEnter={() => setHoveredDay({ dateStr: cell.dateKey, time: cell.time, chars: cell.chars })}
                        onMouseLeave={() => setHoveredDay(null)}
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '2px',
                          background: getCellColor(cell.chars),
                          cursor: 'pointer',
                          transition: 'all 0.1s',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            // Linear grid representation for 7D, 30D, 90D
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', width: '100%' }}>
              {heatmapCells.map((cell, idx) => (
                <div
                  key={idx}
                  onClick={() => setHoveredDay({ dateStr: cell.dateKey, time: cell.time, chars: cell.chars })}
                  onMouseEnter={() => setHoveredDay({ dateStr: cell.dateKey, time: cell.time, chars: cell.chars })}
                  onMouseLeave={() => setHoveredDay(null)}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '4px',
                    background: getCellColor(cell.chars),
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                  title={`${cell.dateKey}: ${cell.chars.toLocaleString()} chars`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TWO COLUMNS: RECENT SESSIONS & BY BOOK */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', paddingBottom: '60px' }}>
        {/* COLUMN 1: RECENT SESSIONS */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>{t.recentSessions}</h3>
            <span style={{ fontSize: '0.75rem', background: 'var(--bg-app)', border: '1px solid var(--border-light)', padding: '2px 8px', borderRadius: '10px', color: 'var(--text-muted)' }}>
              {recentSessionsList.length} {t.shown}
            </span>
          </div>

          {recentSessionsList.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', opacity: 0.8, textAlign: 'center', padding: '30px 0' }}>{t.noSessions}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentSessionsList.map((session, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '12px',
                    borderBottom: idx < recentSessionsList.length - 1 ? '1px solid var(--border-light)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {session.cover ? (
                      <img src={session.cover} alt="" style={{ width: '36px', height: '50px', objectFit: 'cover', borderRadius: '4px' }} />
                    ) : (
                      <div style={{ width: '36px', height: '50px', background: 'var(--bg-app)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <BookOpen size={14} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.title}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{session.dateKey}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)' }}>+{session.chars.toLocaleString()} chars</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDuration(session.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COLUMN 2: BY BOOK */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>{t.byBook}</h3>
            <span style={{ fontSize: '0.75rem', background: 'var(--bg-app)', border: '1px solid var(--border-light)', padding: '2px 8px', borderRadius: '10px', color: 'var(--text-muted)' }}>
              {byBookList.length} {t.shown}
            </span>
          </div>

          {byBookList.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', opacity: 0.8, textAlign: 'center', padding: '30px 0' }}>{t.bookTotalsDesc}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {byBookList.map((book, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '12px',
                    borderBottom: idx < byBookList.length - 1 ? '1px solid var(--border-light)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {book.cover ? (
                      <img src={book.cover} alt="" style={{ width: '36px', height: '50px', objectFit: 'cover', borderRadius: '4px' }} />
                    ) : (
                      <div style={{ width: '36px', height: '50px', background: 'var(--bg-app)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <BookOpen size={14} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {book.title}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{book.author}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)' }}>{book.chars.toLocaleString()} chars</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDuration(book.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
