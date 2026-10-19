import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { DictionaryStep, GuideDots, SlideView, featureSlides, useDictionaryInstall, useSwipe } from './GuideSlides';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImportBook?: () => void;
  lang?: 'es' | 'en';
}

/** The tutorial (first library visit and Settings → tutorial): feature slides, dictionary, done. */
export default function TutorialGuide({ isOpen, onClose, onImportBook, lang = 'en' }: Props) {
  const es = lang === 'es';
  const slides = featureSlides(lang);
  const total = slides.length + 2; // slides, dictionary, done
  const [step, setStep] = useState(0);
  const dictionary = useDictionaryInstall(lang);

  useEffect(() => { if (isOpen) setStep(0); }, [isOpen]);

  const finish = () => {
    localStorage.setItem('yoru_tutorial_seen_v1', 'true');
    onClose();
  };
  const next = () => (step < total - 1 ? setStep(step + 1) : finish());
  const prev = () => setStep(Math.max(0, step - 1));
  const swipe = useSwipe(() => { if (!dictionary.installing) next(); }, prev);

  if (!isOpen) return null;

  const isDictionaryStep = step === slides.length;
  const isDoneStep = step === slides.length + 1;

  return (
    <div className="guide-screen guide-overlay" role="dialog" aria-modal="true" aria-label={es ? 'Tutorial' : 'Tutorial'} {...swipe}>
      <div className="guide-step">
        <div className="guide-top">
          <button type="button" className="guide-icon-btn" onClick={prev} disabled={step === 0} aria-label={es ? 'Atrás' : 'Back'}>
            <ChevronLeft size={22} />
          </button>
          <GuideDots count={total} index={step} onSelect={setStep} lang={lang} />
          <button type="button" className="guide-icon-btn" onClick={finish} aria-label={es ? 'Cerrar tutorial' : 'Close tutorial'}>
            <X size={20} />
          </button>
        </div>

        {step < slides.length && <SlideView slide={slides[step]} />}
        {isDictionaryStep && (
          <div className="guide-slide">
            <h2 className="guide-title">{es ? 'El diccionario' : 'The dictionary'}</h2>
            <DictionaryStep lang={lang} state={dictionary} />
          </div>
        )}
        {isDoneStep && (
          <div className="guide-slide">
            <div className="guide-logo" aria-hidden="true">夜</div>
            <h2 className="guide-title">{es ? '¡Listo para leer!' : 'Ready to read!'}</h2>
            <p className="guide-body">
              {es
                ? 'Añade tu primer libro con el botón + (EPUB, TXT, HTML, PDF o subtítulos). Puedes volver a ver esta guía en Ajustes.'
                : 'Add your first book with the + button (EPUB, TXT, HTML, PDF or subtitles). You can see this guide again in Settings.'}
            </p>
            {onImportBook && (
              <button type="button" className="guide-secondary" onClick={() => { finish(); onImportBook(); }}>
                <Plus size={18} /> {es ? 'Añadir un libro ahora' : 'Add a book now'}
              </button>
            )}
          </div>
        )}

        <div className="guide-bottom">
          <button type="button" className="guide-primary" onClick={next} disabled={dictionary.installing}>
            {isDoneStep
              ? (es ? 'Empezar' : 'Start')
              : isDictionaryStep && !dictionary.hasDictionary ? (es ? 'Ahora no' : 'Not now') : (es ? 'Siguiente' : 'Next')}
            {!isDoneStep && <ChevronRight size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
