import React from 'react';
import {
  ensureNotificationPermission,
  getNotificationPermission,
  notificationSettings,
  YoruNotifications,
} from '../../utils/yoruNotifications';

/** Lo que Android puede contestar sobre el permiso de notificaciones. */
type NotificationPermissionState = 'granted' | 'denied' | 'prompt';

/**
 * Los avisos de Android: qué se notifica y qué no.
 *
 * El aviso aparte, el de arriba, no es un adorno: si Android tiene apagadas las
 * notificaciones de Yoru, estos interruptores no sirven de nada y nadie lo
 * adivinaría mirándolos. Lectura en voz alta sigue funcionando —es un reproductor,
 * no un aviso—, y eso también se dice.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function NotificationSettings({
  lang,
  settings,
  onSaveSettings,
  permission,
  onPermissionChange,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  /** Lo que dice Android ahora mismo. */
  permission: NotificationPermissionState | null;
  onPermissionChange: (value: NotificationPermissionState) => void;
}) {
  const es = lang === 'es';
  const options = notificationSettings(settings);

  const setOption = (key: string, value: boolean | number) => {
    onSaveSettings({ ...settings, [key]: value });
    if (value === true) {
      void ensureNotificationPermission(true).then(() => getNotificationPermission()).then(onPermissionChange);
    }
  };

  const renderToggle = (key: string, checked: boolean, label: string, hint: string) => (
    <div className="settings-row-control" key={key}>
      <span className="settings-label-text" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span>{label}</span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-dark)', fontWeight: 400 }}>{hint}</span>
      </span>
      <label className="migaku-switch">
        <input type="checkbox" checked={checked} onChange={(e) => setOption(key, e.target.checked)} />
        <span className="migaku-switch-slider"></span>
      </label>
    </div>
  );

  const groupTitle = (text: string) => (
    <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dark)', margin: '16px 0 4px' }}>{text}</div>
  );

  return (
    <>
      <p className="settings-card-desc">{es
        ? 'Cada grupo también se puede silenciar desde los ajustes de notificaciones de Android.'
        : 'Each group can also be silenced from Android\'s notification settings.'}</p>

      {permission && permission !== 'granted' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', margin: '12px 0 4px', borderRadius: '10px', background: 'var(--yoru-gold-soft, rgba(242,200,102,0.13))' }}>
          <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-main)' }}>{es
            ? 'Android tiene apagadas las notificaciones de Yoru. El reproductor de lectura sigue funcionando, pero los avisos no.'
            : 'Android has Yoru\'s notifications off. The read-aloud player still works, the notices don\'t.'}</span>
          <button
            type="button"
            className="yoru-btn yoru-btn-primary"
            style={{ flexShrink: 0, padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={async () => {
              if (permission === 'prompt' && await ensureNotificationPermission(true)) {
                onPermissionChange('granted');
              } else {
                void YoruNotifications.openNotificationSettings().catch(() => {});
              }
            }}
          >{es ? 'Activar' : 'Turn on'}</button>
        </div>
      )}

      {groupTitle(es ? 'Lectura en voz alta' : 'Read aloud')}
      {renderToggle('notifyReadAloudBackground', options.readAloudBackground,
        es ? 'Seguir leyendo fuera de la app' : 'Keep reading outside the app',
        es ? 'Con el reproductor en la notificación y la pantalla de bloqueo' : 'With the player in the notification and on the lock screen')}
      {renderToggle('notifyReadAloudSentence', options.readAloudSentence,
        es ? 'Mostrar la oración actual' : 'Show the current sentence',
        es ? 'Si lo apagas, se ve el título del libro' : 'When off, the book title is shown')}

      {groupTitle(es ? 'Repaso' : 'Reviews')}
      {renderToggle('notifySrsDaily', options.srsDaily,
        es ? 'Avisar del nuevo día de repaso' : 'Notify when a new review day starts',
        es ? 'Solo si hay tarjetas pendientes; sin sonido' : 'Only when cards are due; silent')}
      {options.srsDaily && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span className="settings-label-text">{es ? 'Hora del aviso' : 'Reminder time'}</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {String(options.srsHour).padStart(2, '0')}:00
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="23"
            step="1"
            value={options.srsHour}
            onChange={(e) => setOption('notifySrsHour', parseInt(e.target.value, 10))}
            aria-label={es ? 'Hora del aviso de repaso' : 'Review reminder time'}
            style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
        </div>
      )}

      {groupTitle(es ? 'Actualizaciones' : 'Updates')}
      {renderToggle('notifyAppUpdates', options.appUpdates,
        es ? 'Avisar de versiones nuevas' : 'Notify about new versions',
        es ? 'Se buscan una vez al día' : 'Checked once a day')}
      {renderToggle('notifyOtaUpdates', options.otaUpdates,
        es ? 'Avisar de mejoras automáticas' : 'Notify about automatic improvements',
        es ? 'Se instalan solas igualmente' : 'They install themselves anyway')}
    </>
  );
}
