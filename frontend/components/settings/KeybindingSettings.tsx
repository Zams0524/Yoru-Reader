import React from 'react';

/**
 * Las teclas del lector.
 *
 * Se pulsa el botón de un atajo y la siguiente tecla que toques pasa a ser ese
 * atajo. La escucha del teclado no vive aquí: la lleva `Library`, que es quien
 * puede oírla con el foco donde esté. Aquí solo se dice cuál se está grabando.
 *
 * Movido tal cual desde `Library.tsx`, incluido el `alert()` del botón de
 * restablecer, que estaba ahí con una nota admitiendo que era un apaño.
 */

const DEFAULTS: Record<string, string> = {
  toggleFullscreen: 'f',
  nextPage: 'ArrowRight',
  prevPage: 'ArrowLeft',
  toggleMenu: 'Escape',
  readAloud: 't',
  toggleBookmark: 'b',
  goToBookmark: 'r',
  nextChapter: 'n',
  prevChapter: 'm',
};

export default function KeybindingSettings({
  lang,
  settings,
  onSaveSettings,
  recording,
  onRecord,
  onDone,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  /** El atajo que está esperando una tecla, o null. */
  recording: string | null;
  onRecord: (id: string | null) => void;
  /** Avisa de que se hizo, con el aviso de la app. */
  onDone: (message: string) => void;
}) {
  const bindings = settings.keybindings || DEFAULTS;

  const list = [
    { id: 'toggleFullscreen', label: lang === 'es' ? 'Pantalla completa' : 'Full screen' },
    { id: 'nextPage', label: lang === 'es' ? 'Página siguiente' : 'Next page' },
    { id: 'prevPage', label: lang === 'es' ? 'Página anterior' : 'Previous page' },
    { id: 'toggleMenu', label: lang === 'es' ? 'Mostrar/Ocultar Menú' : 'Toggle Menu' },
    { id: 'readAloud', label: lang === 'es' ? 'Leer en voz alta (TTS)' : 'Read aloud (TTS)' },
    { id: 'toggleBookmark', label: lang === 'es' ? 'Poner o quitar marcador' : 'Add or remove bookmark' },
    { id: 'goToBookmark', label: lang === 'es' ? 'Ir al último marcador' : 'Go to last bookmark' },
    { id: 'nextChapter', label: lang === 'es' ? 'Capítulo siguiente' : 'Next chapter' },
    { id: 'prevChapter', label: lang === 'es' ? 'Capítulo anterior' : 'Previous chapter' },
  ];

  return (
    <>
      <p className="settings-card-desc">
        {lang === 'es'
          ? 'Personaliza los atajos de teclado del lector. Haz clic en el botón de un atajo y presiona una tecla para cambiarlo.'
          : 'Customize reader keyboard shortcuts. Click a shortcut button and press a key to change it.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
        {list.map((item) => {
          const isRecording = recording === item.id;
          const val = bindings[item.id];
          let displayVal = val;
          if (val === ' ') displayVal = 'Space';
          if (val === 'ArrowRight') displayVal = '→';
          if (val === 'ArrowLeft') displayVal = '←';
          if (val === 'ArrowUp') displayVal = '↑';
          if (val === 'ArrowDown') displayVal = '↓';

          return (
            <div key={item.id} className="settings-row-control" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
              <span className="settings-label-text" style={{ fontSize: '0.88rem' }}>{item.label}</span>
              <button
                type="button"
                onClick={() => onRecord(isRecording ? null : item.id)}
                style={{
                  background: isRecording ? 'rgba(226, 192, 98, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  border: isRecording ? '1px solid #e2c062' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  color: isRecording ? '#e2c062' : 'rgba(255, 255, 255, 0.9)',
                  padding: '6px 14px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  minWidth: '100px',
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  transition: 'all 0.2s',
                }}
              >
                {isRecording ? (lang === 'es' ? 'Presiona...' : 'Press key...') : displayVal}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          /*
            El aviso de la app, no el del navegador.

            Esto era un `alert()` con una nota al lado admitiendo que era un apaño
            porque desde dentro de Library no se alcanzaba `showToast`. Ahora la
            tarjeta está fuera y le llega por props, así que se acabó el apaño: un
            `alert()` bloquea la ventana entera y se ve como un aviso del sistema,
            no como algo de Yoru.

            Sin diálogo de confirmación a propósito: restablecer cinco teclas se
            deshace volviéndolas a poner, y preguntar antes de algo que no rompe
            nada enseña a la gente a decir que sí sin leer.
          */
          onClick={() => {
            onSaveSettings({ ...settings, keybindings: { ...DEFAULTS } });
            onDone(lang === 'es' ? 'Atajos restablecidos por defecto.' : 'Shortcuts reset to defaults.');
          }}
          style={{
            marginTop: '8px',
            alignSelf: 'flex-start',
            background: 'transparent',
            border: '1px solid var(--border-light)',
            color: 'var(--text-muted)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--text-main)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          {lang === 'es' ? 'Restablecer valores predeterminados' : 'Reset to default values'}
        </button>
      </div>
    </>
  );
}
