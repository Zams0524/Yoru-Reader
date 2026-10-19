import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Download, Headphones, Hand, Loader2, Volume2, Zap } from 'lucide-react';
import { getInstalledDictionaries, installBundledDictionary } from '../../utils/yomitanDB';

/**
 * Pieces of the first-run guide and the tutorial: feature slides with small mock-ups of the real
 * screens, the one-tap dictionary step, and the step dots. Styles: "Onboarding guide" in
 * yoru-design-system.css.
 */

type Lang = 'es' | 'en';
const tr = (lang: Lang, es: string, en: string) => (lang === 'es' ? es : en);

// ── Mock-ups ───────────────────────────────────────────────────────────

function WordMock({ lang }: { lang: Lang }) {
  return (
    <div className="guide-mock guide-mock-page" aria-hidden="true">
      <div className="guide-mock-vertical">
        <span>今日は</span>
        <span>本を<b className="guide-mock-word">読む</b>。</span>
        <span>新しい言葉</span>
      </div>
      <div className="guide-mock-popup">
        <div className="guide-mock-popup-head">
          <strong>読む</strong>
          <span>よむ</span>
          <Volume2 size={14} />
        </div>
        <div className="guide-mock-pitch"><i /><i /></div>
        <div className="guide-mock-def">{tr(lang, '1. leer', '1. to read')}</div>
        <div className="guide-mock-chips">
          <span>{tr(lang, 'Aprender', 'Learn')}</span>
          <span>{tr(lang, 'Conocida', 'Known')}</span>
        </div>
      </div>
      <Hand className="guide-mock-finger" size={26} />
    </div>
  );
}

function ListenMock() {
  return (
    <div className="guide-mock guide-mock-page" aria-hidden="true">
      <div className="guide-mock-lines">
        <span />
        <span className="is-read" />
        <span className="is-read short" />
        <span />
        <span className="short" />
      </div>
      <div className="guide-mock-bar">
        <i className="dot" />
        <i className="play"><Headphones size={14} /></i>
        <i className="dot" />
        <em>1.25×</em>
      </div>
    </div>
  );
}

function SrsMock({ lang }: { lang: Lang }) {
  return (
    <div className="guide-mock guide-mock-srs" aria-hidden="true">
      <div className="guide-mock-card">
        <span className="guide-mock-card-word">言葉</span>
        <span className="guide-mock-card-reading">ことば</span>
      </div>
      <div className="guide-mock-grades">
        <span className="again">{tr(lang, 'Otra vez', 'Again')}</span>
        <span className="hard">{tr(lang, 'Difícil', 'Hard')}</span>
        <span className="good">{tr(lang, 'Bien', 'Good')}</span>
        <span className="easy">{tr(lang, 'Fácil', 'Easy')}</span>
      </div>
    </div>
  );
}

function GesturesMock({ lang }: { lang: Lang }) {
  return (
    <div className="guide-mock guide-mock-gestures" aria-hidden="true">
      <div className="guide-gesture">
        <span className="guide-gesture-icon">⇆</span>
        <span>{tr(lang, 'Desliza para pasar página', 'Swipe to turn pages')}</span>
      </div>
      <div className="guide-gesture">
        <span className="guide-gesture-icon">◎</span>
        <span>{tr(lang, 'Toca el centro: menú y ajustes', 'Tap the center: menu and settings')}</span>
      </div>
      <div className="guide-gesture">
        <span className="guide-gesture-icon">✎</span>
        <span>{tr(lang, 'Mantén pulsado: subrayar y notas', 'Long-press: highlight and notes')}</span>
      </div>
      <div className="guide-gesture">
        <span className="guide-gesture-icon">⌕</span>
        <span>{tr(lang, 'Busca en todo el libro', 'Search the whole book')}</span>
      </div>
    </div>
  );
}

export interface GuideSlide {
  id: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  mock: React.ReactNode;
}

export function featureSlides(lang: Lang): GuideSlide[] {
  return [
    {
      id: 'word',
      icon: <BookOpen size={16} />,
      title: tr(lang, 'Toca cualquier palabra', 'Tap any word'),
      body: tr(lang,
        'Verás su lectura, significado, acento tonal y audio. Márcala para aprenderla y Yoru la colorea en todo el libro.',
        'See its reading, meaning, pitch accent and audio. Mark it to learn it and Yoru colours it across the book.'),
      mock: <WordMock lang={lang} />,
    },
    {
      id: 'listen',
      icon: <Headphones size={16} />,
      title: tr(lang, 'Escucha el libro', 'Listen to the book'),
      body: tr(lang,
        'Pulsa 🎧 y Yoru lee en voz alta, resaltando cada frase y pasando las páginas solo. Elige voz y velocidad.',
        'Press 🎧 and Yoru reads aloud, highlighting each sentence and turning pages for you. Pick the voice and speed.'),
      mock: <ListenMock />,
    },
    {
      id: 'srs',
      icon: <Zap size={16} />,
      title: tr(lang, 'Repasa lo que lees', 'Review what you read'),
      body: tr(lang,
        'Las palabras que aprendes pasan a Yoru SRS, con repasos espaciados (FSRS) para que no se te olviden.',
        'Words you learn go to Yoru SRS, with spaced reviews (FSRS) so you do not forget them.'),
      mock: <SrsMock lang={lang} />,
    },
    {
      id: 'gestures',
      icon: <Hand size={16} />,
      title: tr(lang, 'Lee a tu manera', 'Read your way'),
      body: tr(lang,
        'Vertical (縦書き) u horizontal, modos de color, tamaño de letra… todo desde ⚙ dentro del libro.',
        'Vertical (縦書き) or horizontal, colour modes, font size… all from ⚙ inside the book.'),
      mock: <GesturesMock lang={lang} />,
    },
  ];
}

// ── Dictionary install ─────────────────────────────────────────────────

export function useDictionaryInstall(lang: Lang) {
  const [hasDictionary, setHasDictionary] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await getInstalledDictionaries();
      setHasDictionary((list || []).some((dictionary: any) =>
        dictionary.hasTerms === true ||
        (dictionary.hasTerms === undefined && !dictionary.hasFreqs && !/frequency|frequen|frecuencia|pitch|アクセント|meta/i.test(dictionary.title || ''))));
    } catch {
      setHasDictionary(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener('yoru-dictionaries-changed', onChange);
    return () => window.removeEventListener('yoru-dictionaries-changed', onChange);
  }, [refresh]);

  const install = useCallback(async () => {
    const es = lang === 'es';
    setInstalling(true);
    setError('');
    setProgress(5);
    setMessage(tr(lang, 'Preparando el diccionario…', 'Preparing the dictionary…'));
    try {
      await installBundledDictionary(es ? 'JMdict_spanish.zip' : 'JMdict_english.zip', es ? 'es' : 'en', (msg, value) => {
        setMessage(msg);
        setProgress(10 + Math.round(value * 0.9));
      });
      setProgress(100);
      setHasDictionary(true);
    } catch (err: any) {
      setError(err?.message || 'Error');
    } finally {
      setInstalling(false);
    }
  }, [lang]);

  return { hasDictionary, installing, progress, message, error, install };
}

export function DictionaryStep({ lang, state }: { lang: Lang; state: ReturnType<typeof useDictionaryInstall> }) {
  const { hasDictionary, installing, progress, message, error, install } = state;
  return (
    <div className="guide-dictionary">
      <div className="guide-dictionary-icon">{hasDictionary ? <Check size={30} /> : <Download size={30} />}</div>
      <p className="guide-dictionary-text">
        {hasDictionary
          ? tr(lang, 'El diccionario JMdict ya está instalado. Al tocar una palabra verás su significado.', 'The JMdict dictionary is installed. Tap a word to see its meaning.')
          : tr(lang,
            'Yoru incluye el diccionario JMdict (japonés → español o inglés). Instálalo para ver significados al tocar palabras. Tarda menos de un minuto y no necesita internet.',
            'Yoru bundles the JMdict dictionary (Japanese → English or Spanish). Install it to see meanings when you tap words. It takes under a minute and needs no internet.')}
      </p>
      {!hasDictionary && (
        <button type="button" className="guide-primary" onClick={() => void install()} disabled={installing || hasDictionary === null}>
          {installing ? <><Loader2 size={18} className="guide-spin" /> {progress}%</> : tr(lang, 'Instalar diccionario', 'Install dictionary')}
        </button>
      )}
      {installing && (
        <div className="guide-progress" aria-live="polite">
          <div className="guide-progress-track"><div style={{ width: `${progress}%` }} /></div>
          <span>{message}</span>
        </div>
      )}
      {error && <p className="guide-error">{tr(lang, 'No se pudo instalar: ', 'Could not install: ')}{error}</p>}
    </div>
  );
}

// ── Dots + swipe ───────────────────────────────────────────────────────

export function GuideDots({ count, index, onSelect, lang }: { count: number; index: number; onSelect: (i: number) => void; lang: Lang }) {
  return (
    <div className="guide-dots" role="tablist" aria-label={tr(lang, 'Pasos', 'Steps')}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === index}
          aria-label={tr(lang, `Paso ${i + 1}`, `Step ${i + 1}`)}
          className={i === index ? 'active' : ''}
          onClick={() => onSelect(i)}
        />
      ))}
    </div>
  );
}

/** Horizontal swipe between steps (left = next). */
export function useSwipe(onNext: () => void, onPrev: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return;
      const dx = e.changedTouches[0].clientX - start.current.x;
      const dy = e.changedTouches[0].clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) onNext(); else onPrev();
    },
  };
}

export function SlideView({ slide }: { slide: GuideSlide }) {
  return (
    <div className="guide-slide" key={slide.id}>
      <div className="guide-slide-art">{slide.mock}</div>
      <div className="guide-slide-kicker">{slide.icon}</div>
      <h2 className="guide-title">{slide.title}</h2>
      <p className="guide-body">{slide.body}</p>
    </div>
  );
}
