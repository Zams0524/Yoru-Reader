import React, { useState, useCallback, ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  message2?: string;
  type?: 'default' | 'danger' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Hook reutilizable que reemplaza window.confirm() con un modal estilizado.
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const confirmModal = state ? (
    <ConfirmModal
      title={state.title}
      message={state.message}
      message2={state.message2}
      type={state.type || 'default'}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { showConfirm, confirmModal };
}

interface ConfirmModalProps {
  title?: string;
  message: string;
  message2?: string;
  type?: 'default' | 'danger' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal de confirmación estilizado con el tema de Yoru Reader.
 */
export function ConfirmModal({
  title,
  message,
  message2,
  type = 'default',
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const typeStyles = {
    danger:  { icon: '⚠️', accent: '#ef4444', confirmBg: 'linear-gradient(135deg, #ef4444, #b91c1c)' },
    warning: { icon: '⚠️', accent: '#f59e0b', confirmBg: 'linear-gradient(135deg, #f59e0b, #b45309)' },
    info:    { icon: 'ℹ️', accent: '#60a5fa', confirmBg: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
    default: { icon: '❓', accent: '#FFE000', confirmBg: 'linear-gradient(135deg, #FFE000, #c2aa00)' },
  };

  const ts = typeStyles[type] || typeStyles.default;
  const isDefault = type === 'default';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'confirmOverlayIn 0.18s ease-out',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: '#131316',
          border: `1px solid ${ts.accent}30`,
          borderRadius: '16px',
          padding: '28px 28px 22px',
          maxWidth: '420px',
          width: '90%',
          boxShadow: `0 24px 60px rgba(0,0,0,0.8), 0 0 0 1px ${ts.accent}18`,
          fontFamily: 'var(--font-ui)',
          animation: 'confirmDialogIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Accent bar top */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '3px',
          background: ts.confirmBg,
          borderRadius: '16px 16px 0 0',
        }} />

        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{ts.icon}</span>
          <h3 style={{
            margin: 0,
            color: '#e8e8f0',
            fontSize: '1rem',
            fontWeight: 700,
            fontFamily: 'var(--font-heading)',
            letterSpacing: '0.01em',
          }}>
            {title || (type === 'danger' ? '¿Confirmar acción peligrosa?' : '¿Confirmar?')}
          </h3>
        </div>

        {/* Message */}
        <p style={{
          margin: '0 0 8px 0',
          color: '#b0b0c0',
          fontSize: '0.875rem',
          lineHeight: '1.55',
          paddingLeft: '2px',
        }}>
          {message}
        </p>

        {/* Optional second message (for double-confirm flows) */}
        {message2 && (
          <p style={{
            margin: '6px 0 0 0',
            color: '#888899',
            fontSize: '0.8rem',
            lineHeight: '1.5',
            paddingLeft: '2px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: '8px',
          }}>
            {message2}
          </p>
        )}

        {/* Buttons */}
        <div style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'flex-end',
          marginTop: '20px',
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#888899',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#e8e8f0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888899'; }}
          >
            {cancelText || 'Cancelar'}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: ts.confirmBg,
              color: isDefault ? '#000' : '#fff',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              boxShadow: `0 2px 12px ${ts.accent}33`,
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {confirmText || 'Confirmar'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirmOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes confirmDialogIn {
          from { opacity: 0; transform: scale(0.88) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
export default ConfirmModal;
