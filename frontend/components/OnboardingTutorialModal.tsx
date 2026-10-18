import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Search, 
  Keyboard, 
  Sparkles, 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  Layers, 
  Volume2, 
  Bookmark, 
  Compass, 
  Database, 
  Download, 
  Zap, 
  BarChart3, 
  Loader2,
  Check
} from 'lucide-react';
import { getInstalledDictionaries, installBundledDictionary } from '../utils/yomitanDB';

interface OnboardingTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDictionaries?: () => void;
  lang?: 'es' | 'en';
}

export const OnboardingTutorialModal: React.FC<OnboardingTutorialModalProps> = ({
  isOpen,
  onClose,
  onOpenDictionaries,
  lang = 'en'
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const checkModalMobile = () => (typeof window !== 'undefined' && (
    ((window as any).Capacitor && (window as any).Capacitor.getPlatform() === 'android') ||
    window.innerWidth <= 768 ||
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
  ));
  const [isMobile, setIsMobile] = useState(checkModalMobile);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(checkModalMobile());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [installedDicts, setInstalledDicts] = useState<any[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState('');
  const [installProgress, setInstallProgress] = useState(0);
  const [installSuccess, setInstallSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const refreshDictionaries = () => { checkDicts(); };
    refreshDictionaries();
    window.addEventListener('yoru-dictionaries-changed', refreshDictionaries);
    return () => window.removeEventListener('yoru-dictionaries-changed', refreshDictionaries);
  }, [isOpen]);

  const checkDicts = async () => {
    try {
      const list = await getInstalledDictionaries();
      setInstalledDicts(list || []);
    } catch (e) {
      console.warn('Error checking installed dicts:', e);
    }
  };

  if (!isOpen) return null;

  const totalSteps = 6;

  const handleNext = () => {
    if (currentStep === 1 && !hasDicts) {
      alert(lang === 'es'
        ? 'Por favor, instala el diccionario antes de continuar con el tutorial.'
        : 'Please install the dictionary before continuing with the tutorial.');
      return;
    }
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFinish = () => {
    localStorage.setItem('yoru_tutorial_seen_v1', 'true');
    onClose();
  };

  const handleDirectInstall = async () => {
    const isEs = lang === 'es';
    const assetName = isEs ? 'JMdict_spanish.zip' : 'JMdict_english.zip';
    setIsInstalling(true);
    setInstallSuccess(false);
    setInstallProgress(5);
    setInstallMsg(isEs ? 'Cargando diccionario incluido...' : 'Loading bundled dictionary...');

    try {
      setInstallProgress(10);
      setInstallMsg(isEs ? 'Descomprimiendo y procesando base de datos...' : 'Processing database terms...');
      await installBundledDictionary(assetName, isEs ? 'es' : 'en', (msg, prog) => {
        setInstallMsg(msg);
        setInstallProgress(10 + Math.round(prog * 0.9));
      });

      setInstallProgress(100);
      setInstallSuccess(true);
      setInstallMsg(isEs ? '¡Diccionario instalado con éxito!' : 'Dictionary installed successfully!');
      await checkDicts();
    } catch (err: any) {
      console.error('Error installing dictionary in tutorial:', err);
      alert((lang === 'es' ? 'Error al instalar el diccionario: ' : 'Dictionary installation error: ') + (err?.message || 'Error'));
    } finally {
      setIsInstalling(false);
    }
  };

  const hasDicts = installedDicts.some(dictionary =>
    dictionary.hasTerms === true ||
    (dictionary.hasTerms === undefined && !dictionary.hasFreqs && !/frequency|frequen|frecuencia|pitch|アクセント|meta/i.test(dictionary.title || ''))
  ) || installSuccess;

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '8px' : '20px',
        animation: 'fadeIn 0.2s ease-out',
        boxSizing: 'border-box'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleFinish();
      }}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: isMobile ? '100%' : '680px',
          maxHeight: isMobile ? '94vh' : '90vh',
          background: '#0d0d10',
          border: '1px solid rgba(255, 224, 0, 0.3)',
          borderRadius: isMobile ? '14px' : '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(255, 224, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          color: '#e8e8f0',
          fontFamily: 'var(--font-ui), sans-serif',
          boxSizing: 'border-box'
        }}
      >
        {/* Header with Close */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '12px 14px' : '16px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} style={{ color: '#FFE000' }} />
            <span style={{ fontSize: '0.88rem', fontWeight: 600, letterSpacing: '0.05em', color: '#FFE000', textTransform: 'uppercase' }}>
              {lang === 'es' ? `Guía Rápida de Yoru Reader (${currentStep + 1}/${totalSteps})` : `Yoru Reader Guide (${currentStep + 1}/${totalSteps})`}
            </span>
          </div>
          <button
            onClick={handleFinish}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.5)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}
            title={lang === 'es' ? 'Cerrar' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '28px 32px', minHeight: '360px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          
          {/* STEP 1: Welcome & Formats */}
          {currentStep === 0 && (
            <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                background: 'rgba(255, 224, 0, 0.12)',
                border: '1px solid rgba(255, 224, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: '#FFE000'
              }}>
                <BookOpen size={28} />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '8px', color: '#fff' }}>
                {lang === 'es' ? '¡Bienvenido a Yoru Reader!' : 'Welcome to Yoru Reader!'}
              </h2>
              <p style={{ color: '#a0a0b0', fontSize: '0.92rem', lineHeight: '1.5', marginBottom: '20px' }}>
                {lang === 'es' 
                  ? 'Tu plataforma completa para leer novelas y libros en japonés con herramientas integradas de inmersión y aprendizaje.'
                  : 'Your complete Japanese novel reader equipped with integrated immersion and learning tools.'}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#FFE000', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Layers size={15} /> {lang === 'es' ? 'Formatos Soportados' : 'Supported Formats'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#888899', lineHeight: '1.4' }}>
                    {lang === 'es' ? 'Importa EPUB, PDF (con lectura vertical 縦書き), TXT y HTML.' : 'Import EPUB, PDF (with vertical layout), TXT, and HTML.'}
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#FFE000', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Compass size={15} /> {lang === 'es' ? 'Lectura Vertical' : 'Vertical Reading'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#888899', lineHeight: '1.4' }}>
                    {lang === 'es' ? 'Lee en auténtico formato vertical japonés tradicional (縦書き) u horizontal.' : 'Switch between authentic Japanese vertical and horizontal modes.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Instalar Diccionarios (DIRECT 1-CLICK INSTALLATION WITHOUT LOSING TUTORIAL PROGRESS) */}
          {currentStep === 1 && (
            <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                background: hasDicts ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 94, 98, 0.15)',
                border: hasDicts ? '1px solid rgba(0, 230, 118, 0.4)' : '1px solid rgba(255, 94, 98, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: hasDicts ? '#00e676' : '#ff5e62'
              }}>
                {hasDicts ? <CheckCircle2 size={28} /> : <Database size={28} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  {lang === 'es' ? 'Paso Fundamental: Instalar Diccionarios' : 'Key Step: Install Dictionaries'}
                </h2>
                <span style={{ 
                  background: hasDicts ? '#059669' : '#ef4444', 
                  color: '#fff', 
                  fontSize: '0.65rem', 
                  fontWeight: 800, 
                  padding: '2px 6px', 
                  borderRadius: '4px' 
                }}>
                  {hasDicts ? (lang === 'es' ? 'LISTO' : 'READY') : (lang === 'es' ? 'IMPORTANTE' : 'IMPORTANT')}
                </span>
              </div>
              <p style={{ color: '#a0a0b0', fontSize: '0.88rem', lineHeight: '1.5', marginBottom: '16px' }}>
                {lang === 'es'
                  ? 'Para buscar significados, furigana y clasificar palabras mientras lees, necesitas tener instalados los diccionarios.'
                  : 'To look up definitions, furigana, and track vocabulary, you need to install dictionary packages.'}
              </p>

              {/* Status Box or Installer */}
              {hasDicts ? (
                <>
                  <div style={{
                    background: 'rgba(0, 230, 118, 0.08)',
                    border: '1px solid rgba(0, 230, 118, 0.25)',
                    borderRadius: '12px',
                    padding: '16px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    marginBottom: '12px'
                  }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#00e676', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', flexShrink: 0 }}>
                      <Check size={20} strokeWidth={3} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff' }}>
                        {lang === 'es' ? '¡Diccionario instalado y activo!' : 'Dictionary installed and active!'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#a0a0b0' }}>
                        {lang === 'es' 
                          ? 'Tu lector ya está listo para consultar palabras y furigana. Pulsa "Siguiente" para continuar el tutorial.' 
                          : 'Your reader is ready for word lookups and furigana. Press "Next" to continue tutorial.'}
                      </div>
                    </div>
                  </div>

                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    fontSize: '0.82rem',
                    color: '#aaa',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    lineHeight: '1.4'
                  }}>
                    <span style={{ fontSize: '1rem' }}>💡</span>
                    <span>
                      {lang === 'es'
                        ? 'Para instalar más diccionarios o listas de frecuencias (Netflix, JPDB, Anime, Novelas), ve a Ajustes (⚙️) ➔ Diccionarios.'
                        : 'To install more dictionaries or frequency lists (Netflix, JPDB, Anime, Novels), go to Settings (⚙️) ➔ Dictionaries.'}
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '14px' }}>
                  {/* DIRECT 1-CLICK INSTALLATION BUTTON */}
                  <button
                    type="button"
                    onClick={handleDirectInstall}
                    disabled={isInstalling}
                    style={{
                      width: '100%',
                      padding: '14px 20px',
                      background: isInstalling 
                        ? 'rgba(255, 255, 255, 0.1)' 
                        : 'linear-gradient(135deg, #ff5e62 0%, #ff9966 100%)',
                      border: 'none',
                      borderRadius: '10px',
                      color: '#fff',
                      fontSize: '0.94rem',
                      fontWeight: 700,
                      cursor: isInstalling ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      boxShadow: isInstalling ? 'none' : '0 4px 18px rgba(255, 94, 98, 0.45)',
                      transition: 'all 0.15s'
                    }}
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        <span>{installMsg || (lang === 'es' ? 'Instalando diccionario...' : 'Installing dictionary...')}</span>
                      </>
                    ) : (
                      <>
                        <Download size={20} />
                        <span>{lang === 'es' ? '⚡ Instalar Diccionario JMdict (Español) - 1 Clic' : '⚡ Install JMdict Dictionary (English) - 1 Click'}</span>
                      </>
                    )}
                  </button>

                  {/* Live progress bar */}
                  {isInstalling && (
                    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '8px', overflow: 'hidden', height: '6px', width: '100%' }}>
                      <div style={{
                        background: '#FFE000',
                        height: '100%',
                        width: `${installProgress}%`,
                        transition: 'width 0.2s ease'
                      }} />
                    </div>
                  )}

                  <div style={{ fontSize: '0.78rem', color: '#888899', textAlign: 'center' }}>
                    💡 {lang === 'es' ? 'Diccionario incluido: se instalará aquí sin salir del tutorial.' : 'Bundled dictionary: install it here without leaving the tutorial.'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Smart Dictionary & Shift+Hover */}
          {currentStep === 2 && (
            <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                background: 'rgba(52, 211, 153, 0.12)',
                border: '1px solid rgba(52, 211, 153, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: '#34d399'
              }}>
                <Search size={28} />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '8px', color: '#fff' }}>
                {lang === 'es' ? 'Diccionario Inteligente y Furigana' : 'Smart Dictionary & Furigana'}
              </h2>
              <p style={{ color: '#a0a0b0', fontSize: '0.92rem', lineHeight: '1.5', marginBottom: '16px' }}>
                {lang === 'es'
                  ? 'Consulta cualquier término japonés mientras lees de forma rápida y sin distracciones:'
                  : 'Look up any Japanese word while reading quickly and seamlessly:'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ background: 'rgba(255, 224, 0, 0.08)', border: '1px solid rgba(255, 224, 0, 0.3)', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ background: '#FFE000', color: '#000', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, flexShrink: 0 }}>
                    {isMobile ? (lang === 'es' ? 'TOCA' : 'TAP') : 'SHIFT'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#FFE000' }}>
                      {isMobile 
                        ? (lang === 'es' ? 'Toca cualquier palabra' : 'Tap any word')
                        : (lang === 'es' ? 'Coloca el cursor + Presiona Shift' : 'Hover word + Press Shift')}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#ccc' }}>
                      {isMobile
                        ? (lang === 'es' 
                            ? 'En el modo de lectura, toca cualquier palabra japonesa para abrir su definición, furigana y audio instantáneamente.' 
                            : 'In reading mode, tap any Japanese word to instantly view its definition, furigana, and audio.')
                        : (lang === 'es' 
                            ? 'En el modo de lectura, pon el ratón sobre cualquier palabra y presiona Shift para abrir el diccionario.' 
                            : 'In reading mode, place your cursor over any word and press Shift to show definition.')}
                    </div>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Volume2 size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{lang === 'es' ? 'Audio y Pronunciación' : 'Audio & Pronunciation'}</div>
                    <div style={{ fontSize: '0.78rem', color: '#888899' }}>{lang === 'es' ? 'Escucha la pronunciación nativa y consulta el acento tonal (pitch accent).' : 'Listen to native audio and view pitch accent.'}</div>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Bookmark size={18} style={{ color: '#a3e635', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{lang === 'es' ? 'Seguimiento de Vocabulario' : 'Vocabulary Tracking'}</div>
                    <div style={{ fontSize: '0.78rem', color: '#888899' }}>{lang === 'es' ? 'Clasifica palabras en Nuevo, Aprendiendo, Conocido o Ignorado.' : 'Tag words as New, Learning, Known, or Ignored.'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Touch Controls / Keyboard Shortcuts */}
          {currentStep === 3 && (
            <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                background: 'rgba(244, 114, 182, 0.12)',
                border: '1px solid rgba(244, 114, 182, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: '#f472b6'
              }}>
                <Keyboard size={28} />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '6px', color: '#fff' }}>
                {isMobile 
                  ? (lang === 'es' ? 'Gestos y Controles Táctiles' : 'Touch Controls & Gestures')
                  : (lang === 'es' ? 'Atajos de Teclado Esenciales' : 'Essential Keyboard Shortcuts')}
              </h2>
              <p style={{ color: '#a0a0b0', fontSize: '0.88rem', marginBottom: '14px' }}>
                {isMobile
                  ? (lang === 'es' ? 'Lee cómodamente con gestos táctiles en tu teléfono:' : 'Read seamlessly using mobile touch gestures:')
                  : (lang === 'es' ? 'Navega y controla el lector a máxima velocidad:' : 'Control and navigate the reader with speed:')}
              </p>

              {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ background: 'rgba(255, 224, 0, 0.06)', border: '1px solid rgba(255, 224, 0, 0.25)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 600 }}>{lang === 'es' ? 'Paginación' : 'Page Navigation'}</span>
                    <span style={{ background: '#FFE000', color: '#000', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>{lang === 'es' ? 'Tocar Bordes / Swipe' : 'Tap Edges / Swipe'}</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Menú de Lectura' : 'Reading Menu'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, color: '#FFE000' }}>{lang === 'es' ? 'Tocar Centro' : 'Tap Center'}</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Diccionario Instantáneo' : 'Instant Dictionary'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, color: '#FFE000' }}>{lang === 'es' ? 'Tocar Palabra' : 'Tap Word'}</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Modo Vertical (縦書き)' : 'Vertical Mode (縦書き)'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, color: '#FFE000' }}>{lang === 'es' ? 'Ajustes o Rotación' : 'Settings / Rotation'}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ background: 'rgba(255, 224, 0, 0.06)', border: '1px solid rgba(255, 224, 0, 0.25)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 600 }}>{lang === 'es' ? 'Ver Diccionario' : 'Inspect Dictionary'}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ background: '#FFE000', color: '#000', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 800 }}>Shift</span>
                      <span style={{ fontSize: '0.75rem', color: '#FFE000', display: 'flex', alignItems: 'center' }}>+ Hover</span>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Avanzar / Retroceder' : 'Next / Prev page'}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#FFE000' }}>Space</span>
                      <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#FFE000' }}>J / K</span>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Pantalla Completa' : 'Toggle Fullscreen'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#FFE000' }}>F</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Vertical / Horizontal' : 'Vertical / Horizontal'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#FFE000' }}>V</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Crear tarjeta Anki / SRS' : 'Create Anki/SRS Card'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#FFE000' }}>A</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#ccc' }}>{lang === 'es' ? 'Ajustes de Lectura' : 'Reading Settings'}</span>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#FFE000' }}>Q</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Yoru SRS & Estadísticas */}
          {currentStep === 4 && (
            <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                background: 'rgba(255, 224, 0, 0.12)',
                border: '1px solid rgba(255, 224, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: '#FFE000'
              }}>
                <Zap size={28} />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '8px', color: '#fff' }}>
                {lang === 'es' ? 'Yoru SRS y Estadísticas de Lectura' : 'Yoru SRS & Reading Statistics'}
              </h2>
              <p style={{ color: '#a0a0b0', fontSize: '0.92rem', lineHeight: '1.5', marginBottom: '16px' }}>
                {lang === 'es'
                  ? 'Todo lo que necesitas para memorizar vocabulario y medir tu progreso en tiempo real:'
                  : 'Everything you need to memorize vocabulary and track reading progress in real time:'}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#FFE000', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Zap size={16} /> {lang === 'es' ? 'Yoru SRS (Repaso Espaciado)' : 'Yoru SRS (Spaced Repetition)'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#888899', lineHeight: '1.4' }}>
                    {lang === 'es' 
                      ? 'Guarda palabras de tus novelas en mazos de estudio con audio y oraciones de contexto para repasarlas a diario.' 
                      : 'Save words into study decks with audio and context sentences to review daily.'}
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#38bdf8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <BarChart3 size={16} /> {lang === 'es' ? 'Estadísticas y Racha' : 'Statistics & Streak'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#888899', lineHeight: '1.4' }}>
                    {lang === 'es' 
                      ? 'Monitorea tu velocidad de lectura (chars/h), tiempo total, mapa de calor y días consecutivos de lectura.' 
                      : 'Track your reading speed (chars/h), total time, heatmap, and consecutive daily streak.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Ready to Start */}
          {currentStep === 5 && (
            <div style={{ animation: 'fadeIn 0.25s ease-out', textAlign: 'center', padding: '10px 0' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(255, 224, 0, 0.15)',
                border: '2px solid #FFE000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                color: '#FFE000'
              }}>
                <CheckCircle2 size={36} />
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px', color: '#fff' }}>
                {lang === 'es' ? '¡Todo Listo para Empezar!' : 'You Are All Set!'}
              </h2>
              <p style={{ color: '#a0a0b0', fontSize: '0.95rem', lineHeight: '1.5', maxWidth: '440px', margin: '0 auto 20px auto' }}>
                {lang === 'es'
                  ? 'Arrastra tus archivos de libros a la biblioteca o usa el botón "+" para comenzar tu aventura de lectura.'
                  : 'Drag & drop your book files into the library or use the "+" button to begin your Japanese reading adventure.'}
              </p>
              <div style={{ fontSize: '0.82rem', color: '#888899', background: 'rgba(255,255,255,0.03)', padding: '8px 16px', borderRadius: '20px', display: 'inline-block' }}>
                💡 {lang === 'es' ? 'Puedes volver a ver este tutorial en cualquier momento desde los Ajustes (⚙️).' : 'You can revisit this tutorial anytime in Settings (⚙️).'}
              </div>
            </div>
          )}

        </div>

        {/* Footer Navigation */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '10px 14px' : '16px 24px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          {/* Step dots */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {Array.from({ length: totalSteps }).map((_, idx) => {
              const isDotDisabled = isInstalling || (idx > 1 && !hasDicts);
              return (
                <button
                  key={idx}
                  disabled={isDotDisabled}
                  onClick={() => setCurrentStep(idx)}
                  style={{
                    width: currentStep === idx ? '22px' : '7px',
                    height: '7px',
                    borderRadius: '4px',
                    background: currentStep === idx ? '#FFE000' : 'rgba(255, 255, 255, 0.2)',
                    border: 'none',
                    cursor: isDotDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDotDisabled ? 0.3 : 1,
                    padding: 0,
                    transition: 'all 0.2s ease'
                  }}
                  title={lang === 'es' ? `Paso ${idx + 1}` : `Step ${idx + 1}`}
                />
              );
            })}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                disabled={isInstalling}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: isInstalling ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s'
                }}
              >
                <ChevronLeft size={16} />
                {lang === 'es' ? 'Anterior' : 'Back'}
              </button>
            )}

            {(() => {
              const isNextDisabled = isInstalling || (currentStep === 1 && !hasDicts);
              return (
                <button
                  onClick={handleNext}
                  disabled={isNextDisabled}
                  style={{
                    padding: '8px 20px',
                    background: isNextDisabled 
                      ? 'rgba(255, 255, 255, 0.12)' 
                      : 'linear-gradient(135deg, #FFE000 0%, #c2aa00 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: isNextDisabled ? 'rgba(255, 255, 255, 0.4)' : '#000',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: isNextDisabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: isNextDisabled ? 'none' : '0 4px 14px rgba(255, 224, 0, 0.3)',
                    transition: 'all 0.15s'
                  }}
                  title={isNextDisabled && currentStep === 1 ? (lang === 'es' ? 'Instala el diccionario para continuar' : 'Install dictionary to proceed') : ''}
                >
                  {currentStep === totalSteps - 1 
                    ? (lang === 'es' ? '¡Empezar a leer!' : 'Get Started!')
                    : (lang === 'es' ? 'Siguiente' : 'Next')
                  }
                  {currentStep < totalSteps - 1 && <ChevronRight size={16} />}
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
