import React from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onClose: () => void;
  colors: { textMain: string; textMuted: string; border?: string; popoverBg?: string };
  closeLabel: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

/** Right-hand slide-in panel with the reader sidebar's look (search, notes). */
export default function ReaderSidePanel({ title, onClose, colors, closeLabel, headerExtra, children }: Props) {
  return (
    <>
      <div className="reader-side-panel-backdrop" onClick={onClose} />
      <div
        className="reader-side-panel"
        role="dialog"
        aria-label={title}
        style={{ background: colors.popoverBg || '#0c0c0e', borderLeft: `1px solid ${colors.border || 'rgba(255,255,255,0.08)'}` }}
      >
        <div className="reader-side-panel-header" style={{ borderBottom: `1px solid ${colors.border || 'rgba(255,255,255,0.08)'}` }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: colors.textMain }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="reader-side-panel-close" style={{ color: colors.textMuted }}>
            <X size={20} />
          </button>
        </div>
        {headerExtra}
        <div className="reader-side-panel-body">{children}</div>
      </div>
    </>
  );
}
