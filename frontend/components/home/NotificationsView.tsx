import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { NOTICES_EVENT, clearNotices, getNotices, markNoticesSeen, type AppNotice } from '../../utils/appNotices';

/**
 * Notificaciones: lo que ha terminado mientras hacías otra cosa.
 *
 * Vacía casi siempre, y eso está bien: lo dice con una frase en vez de con una lista
 * de adorno. Al abrirla, lo que hubiera se da por visto y la campana se apaga.
 */
export default function NotificationsView({ es }: { es: boolean }) {
  const [notices, setNotices] = useState<AppNotice[]>(() => getNotices());

  useEffect(() => {
    markNoticesSeen();
    const refresh = () => setNotices(getNotices());
    window.addEventListener(NOTICES_EVENT, refresh);
    return () => window.removeEventListener(NOTICES_EVENT, refresh);
  }, []);

  const when = (at: number) =>
    new Date(at).toLocaleString(es ? 'es' : 'en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="yoru-notices">
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Notificaciones' : 'Notifications'}</h1>
        </div>
        {notices.length > 0 && (
          <button type="button" className="yoru-btn" onClick={clearNotices}>
            {es ? 'Borrar todas' : 'Clear all'}
          </button>
        )}
      </div>

      {notices.length === 0 ? (
        <div className="yoru-notices-empty">
          <span className="yoru-profile-panel-icon"><Bell size={18} /></span>
          <strong>{es ? 'Estás al día' : 'You’re all caught up'}</strong>
          <span>{es ? 'Cuando termine una tarea, verás aquí el resultado.' : 'When a task finishes, you’ll see the result here.'}</span>
        </div>
      ) : (
        <ul className="yoru-notices-list">
          {notices.map((notice) => (
            <li key={notice.id} className="yoru-notice">
              <span className="yoru-notice-text">
                <strong>{notice.title}</strong>
                {notice.body && <span>{notice.body}</span>}
              </span>
              <time dateTime={new Date(notice.at).toISOString()}>{when(notice.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
