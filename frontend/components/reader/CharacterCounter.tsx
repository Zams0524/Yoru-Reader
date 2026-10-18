import React from 'react';

interface ReaderColors {
  textMain: string;
  textMuted: string;
  headerBg?: string;
  border?: string;
  popoverBg?: string;
  cardBg?: string;
  accent: string;
}

interface CharacterCounterProps {
  currChars: number;
  totalChars: number;
  colors: ReaderColors;
}

export default function CharacterCounter({ currChars, totalChars, colors }: CharacterCounterProps) {
  const percentage = totalChars > 0 ? ((currChars / totalChars) * 100).toFixed(1) : '0.0';

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        height: '3px',
        background: 'rgba(255, 255, 255, 0.1)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.max(1, parseFloat(percentage))}%`,
          background: 'linear-gradient(90deg, #FFE000, #FFA500)',
          boxShadow: '0 0 8px rgba(255, 224, 0, 0.6)',
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  );
}
