import React, { useState, useRef, useEffect } from 'react';
import { Camera, User, Globe } from 'lucide-react';
import { t } from '../utils/i18n';
import JSZip from 'jszip';
import { db } from '../utils/db';
import { googleDriveService, signInWithGoogle, LAST_SYNC_STORAGE_KEY } from '../utils/googleDriveService';
import { useConfirm } from './ConfirmModal';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DictionaryStep, GuideDots, SlideView, featureSlides, useArrowKeys, useDictionaryInstall, useSwipe } from './onboarding/GuideSlides';
import { leerSesion } from '../utils/discordAuth';

declare global {
  interface Window {
    electronAPI: any;
  }
}

const PRESET_AVATARS = [
  { avatar: 'linear-gradient(135deg, #ff5e62 0%, #ff9966 100%)', emoji: '🦊' },
  { avatar: 'linear-gradient(135deg, #8e78ff 0%, #4f46e5 100%)', emoji: '🐱' },
  { avatar: 'linear-gradient(135deg, #34d399 0%, #059669 100%)', emoji: '🐸' },
  { avatar: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)', emoji: '🐥' },
  { avatar: 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)', emoji: '🌸' },
  { avatar: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)', emoji: '🐳' },
  { avatar: 'linear-gradient(135deg, #a3a3a3 0%, #404040 100%)', emoji: '🐼' },
  { avatar: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', emoji: '🌙' },
];

interface WelcomeScreenProps {
  /** La guía ha terminado (o se ha saltado): a la biblioteca. */
  onTerminar: () => void;
  settings: any;
  onSaveSettings: (settings: any) => void;
}

export default function WelcomeScreen({ onTerminar, settings = {}, onSaveSettings }: WelcomeScreenProps) {
  const lang = settings.appLanguage || 'en';
  /*
    El nombre viene puesto con el de Discord, porque a esta pantalla solo se llega
    después de entrar con Discord: pedirlo otra vez seria pedir dos veces lo mismo.
    Se puede cambiar, que para eso es un campo y no una etiqueta.
  */
  const [name, setName] = useState(() => leerSesion()?.usuarioNombre || '');
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [canCancelDriveAuth, setCanCancelDriveAuth] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localBackupInputRef = useRef<HTMLInputElement>(null);

  const activeTheme = settings.theme || 'dark';
  const driveColor = activeTheme === 'dark' ? '#34d399' : '#059669';
  const driveBg = activeTheme === 'dark' ? 'rgba(52, 211, 153, 0.05)' : 'rgba(5, 150, 105, 0.05)';
  const driveBorder = activeTheme === 'dark' ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(5, 150, 105, 0.25)';

  const { showConfirm, confirmModal } = useConfirm();

  // Custom themed toast notifications
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const toastTimerRef = useRef<any>(null);

  const showToast = React.useCallback((message: string, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  }, []);

  const handleImportLocalBackup = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      document.body.style.cursor = 'wait';
      let importData: any = null;
      let zip: JSZip | null = null;
      const isZip = file.name.toLowerCase().endsWith('.zip');

      if (isZip) {
        zip = await JSZip.loadAsync(file);
        const metaFile = zip.file('metadata.json');
        if (!metaFile) {
          showToast(lang === 'es' ? 'El archivo zip no contiene metadatos válidos de Yoru Reader.' : 'The zip file does not contain valid Yoru Reader metadata.', 'error');
          return;
        }
        const metaStr = await metaFile.async('text');
        importData = JSON.parse(metaStr);
      } else {
        // Legacy JSON backup support
        const text = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = (evt) => resolve(evt.target?.result as string);
          r.onerror = (err) => reject(err);
          r.readAsText(file);
        });
        importData = JSON.parse(text);
      }

      if (!importData.books && !importData.profiles) {
        await showConfirm({
          title: lang === 'es' ? 'Error de respaldo' : 'Backup error',
          message: lang === 'es' ? 'El archivo no tiene un formato de respaldo válido de Yoru Reader.' : 'The file does not have a valid Yoru Reader backup format.',
          type: 'warning',
          confirmText: lang === 'es' ? 'Entendido' : 'OK',
          cancelText: '',
        });
        return;
      }

      const ok = await showConfirm({
        title: lang === 'es' ? '¿Restaurar respaldo?' : 'Restore backup?',
        message: lang === 'es'
          ? 'Al restaurar la copia de seguridad se combinarán o sobrescribirán los datos. ¿Deseas continuar?'
          : 'Restoring the backup will merge or overwrite current data. Do you want to continue?',
        type: 'warning',
        confirmText: lang === 'es' ? 'Continuar' : 'Continue',
      });

      if (ok) {
        // 1. Restore active profile ID
        if (importData.activeProfileId) {
          localStorage.setItem('migaku_reader_active_profile_id', importData.activeProfileId);
        } else if (importData.profiles && importData.profiles.length > 0) {
          localStorage.setItem('migaku_reader_active_profile_id', importData.profiles[0].id);
        }

        // 2. Merge profiles
        if (importData.profiles) {
          db.saveProfiles(importData.profiles);
        }

        // 3. Merge books
        if (importData.books) {
          await db.saveBooks(importData.books);
        }
        
        // 4. Restore word statuses
        if (importData.wordStatuses) {
          db.saveWordStatuses(importData.wordStatuses);
        }

        // 5. Restore settings
        if (importData.settings) {
          db.saveSettings(importData.settings);
        }
        if (importData.ankiSettings) {
          localStorage.setItem('anki_settings', JSON.stringify(importData.ankiSettings));
        }
        if (importData.ankiSettingsV2) {
          localStorage.setItem('anki_settings_v2', JSON.stringify(importData.ankiSettingsV2));
        }

        // 6. Restore Yomitan dictionary metadata
        if (importData.dictionaries && importData.dictionaries.length > 0) {
          const { importAllDictionaryData } = await import('../utils/yomitanDB');
          await importAllDictionaryData({
            dictionaries: importData.dictionaries,
            terms: [],
            frequencies: []
          });
        }

        // 7. Load chunks of terms and frequencies from Zip if present
        if (isZip && zip) {
          const { importAllDictionaryData } = await import('../utils/yomitanDB');
          // Load terms chunks
          const termsInfoFile = zip.file('terms_info.json');
          if (termsInfoFile) {
            const termsInfo = JSON.parse(await termsInfoFile.async('text'));
            for (let c = 0; c < termsInfo.chunkCount; c++) {
              const chunkFile = zip.file(`terms_chunk_${c}.json`);
              if (chunkFile) {
                const chunkStr = await chunkFile.async('text');
                const chunkData = JSON.parse(chunkStr);
                await importAllDictionaryData({ dictionaries: [], terms: chunkData, frequencies: [] });
              }
            }
          }

          // Load frequencies chunks
          const freqsInfoFile = zip.file('freqs_info.json');
          if (freqsInfoFile) {
            const freqsInfo = JSON.parse(await freqsInfoFile.async('text'));
            for (let c = 0; c < freqsInfo.chunkCount; c++) {
              const chunkFile = zip.file(`freqs_chunk_${c}.json`);
              if (chunkFile) {
                const chunkStr = await chunkFile.async('text');
                const chunkData = JSON.parse(chunkStr);
                await importAllDictionaryData({ dictionaries: [], terms: [], frequencies: chunkData });
              }
            }
          }

          const { importMetaPacksFromZip } = await import('../utils/yomitanDB');
          await importMetaPacksFromZip(zip);
        }

        showToast(lang === 'es' ? '✅ Copia de seguridad restaurada con éxito. Reiniciando...' : '✅ Backup restored successfully. Restarting...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (e: any) {
      console.error(e);
      showToast((lang === 'es' ? 'Error al importar la biblioteca: ' : 'Error importing library: ') + (e.message || String(e)), 'error');
    } finally {
      document.body.style.cursor = 'default';
    }
  };

  // Handle F shortcut for Fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error enabling full-screen mode: ${err.message}`);
          });
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sign in with Google: brings back the progress synced from another device (or the last full
  // backup) and keeps syncing from now on. With nothing in Drive yet, the user creates a profile
  // and its progress starts being saved there.
  const handleGoogleSignIn = async () => {
    try {
      setIsSyncing(true);
      document.body.style.cursor = 'wait';
      const session = await signInWithGoogle(setCanCancelDriveAuth);

      const syncData = await googleDriveService.downloadSyncFile(session.tokens, session.clientId, session.clientSecret);
      if (syncData) {
        await db.importFullDatabase(syncData);
        localStorage.setItem(LAST_SYNC_STORAGE_KEY, new Date().toISOString());
        localStorage.setItem('yoru_tutorial_seen_v1', 'true');
        showToast(lang === 'es' ? 'Progreso recuperado de Google Drive. Reiniciando...' : 'Progress restored from Google Drive. Restarting...', 'success');
        setTimeout(() => window.location.reload(), 1200);
        return;
      }

      const zipBlob = await googleDriveService.downloadBlobFile(
        session.tokens, session.clientId, 'yoru_reader_full_backup.zip', session.clientSecret
      );
      if (zipBlob) {
        const fileObj = new File([zipBlob], 'yoru_reader_full_backup.zip', { type: 'application/zip' });
        await handleImportLocalBackup({ target: { files: [fileObj] } });
        return;
      }

      showToast(lang === 'es'
        ? `Sesión iniciada como ${session.email}. Crea tu perfil y tu progreso se guardará en tu Google Drive.`
        : `Signed in as ${session.email}. Create your profile and your progress will be saved to your Google Drive.`, 'success');
    } catch (e: any) {
      console.error(e);
      if (!String(e?.message || '').toLowerCase().includes('cancelled')) {
        showToast((lang === 'es' ? 'No se pudo iniciar sesión con Google: ' : 'Google sign-in failed: ') + e.message, 'error');
      }
    } finally {
      setCanCancelDriveAuth(false);
      setIsSyncing(false);
      document.body.style.cursor = 'default';
    }
  };

  const cancelDriveSignIn = async () => {
    if (!canCancelDriveAuth) return;
    try {
      await window.electronAPI?.cancelGoogleOauth?.();
    } finally {
      setCanCancelDriveAuth(false);
      setIsSyncing(false);
      document.body.style.cursor = 'default';
    }
  };

  const handleFileChange = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event: any) => {
      setCustomAvatarUrl(event.target.result);
      setSelectedPresetIdx(-1);
    };
    reader.onerror = async () => {
      await showConfirm({
        title: lang === 'es' ? 'Error al cargar imagen' : 'Error loading image',
        message: t('errorLoadImage', lang),
        type: 'warning',
        confirmText: lang === 'es' ? 'Entendido' : 'OK',
        cancelText: '',
      });
    };
    reader.readAsDataURL(file);
  };


  // La guía del primer día: bienvenida → 4 diapositivas → diccionario → a leer.
  // El paso del perfil ya no está: lo trae Discord.
  const slides = featureSlides(lang === 'es' ? 'es' : 'en');
  const guideLang: 'es' | 'en' = lang === 'es' ? 'es' : 'en';
  const [step, setStep] = useState(0);
  const lastGuideStep = slides.length + 1; // 0 welcome, 1..4 slides, 5 dictionary, 6 profile
  const dictionary = useDictionaryInstall(guideLang);
  /** La guía se da por vista una sola vez; después no vuelve a aparecer. */
  const terminar = () => {
    try { localStorage.setItem('yoru_tutorial_seen_v1', 'true'); } catch { /* sin almacenamiento, se verá otra vez */ }
    onTerminar();
  };

  // Pasado el último paso ya no hay pantalla de perfil que enseñar: se termina.
  const goNext = () => setStep((value) => {
    if (value >= lastGuideStep) { terminar(); return value; }
    return value + 1;
  });
  const goPrev = () => setStep((value) => Math.max(0, value - 1));
  const swipe = useSwipe(() => { if (step > 0 && step <= lastGuideStep) goNext(); }, () => { if (step > 0 && step <= lastGuideStep) goPrev(); });
  const es = lang === 'es';
  useArrowKeys(
    () => { if (step <= lastGuideStep) goNext(); },
    () => { if (step > 0 && step <= lastGuideStep) goPrev(); },
    step <= lastGuideStep,
  );

  const setLanguage = (selectedLang: string) => {
    localStorage.setItem('app_language', selectedLang);
    onSaveSettings({ ...settings, appLanguage: selectedLang });
  };

  if (step <= lastGuideStep) {
    return (
      <div className="guide-screen" {...swipe}>
        {step === 0 ? (
          <div className="guide-welcome">
            <div className="guide-lang" role="radiogroup" aria-label="Idioma / Language">
              {[{ id: 'es', label: 'Español' }, { id: 'en', label: 'English' }].map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={lang === option.id} className={lang === option.id ? 'active' : ''} onClick={() => setLanguage(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="guide-logo" aria-hidden="true">夜</div>
            <h1 className="guide-brand">Yoru Reader</h1>
            <p className="guide-tagline">
              {es ? 'Aprende japonés leyendo las novelas que te gustan.' : 'Learn Japanese by reading the novels you love.'}
            </p>
            {/*
              A la guía solo se llega ya dentro: entrar con Discord y la comprobación
              de que eres del servidor pasan antes, en la pantalla de acceso. Se dice
              aquí para que el recibimiento no suene a que queda algo por demostrar.
            */}
            <p className="guide-tagline guide-tagline-sub">
              {es
                ? 'Ya has entrado con Discord como miembro del servidor, y tu perfil usa tu nombre y tu foto de allí. Solo queda ver lo que trae.'
                : 'You are signed in with Discord as a member of the server, and your profile uses your name and picture from there. All that is left is a look around.'}
            </p>
            <ul className="guide-points">
              <li>{es ? 'Diccionario al tocar cualquier palabra' : 'A dictionary on every word you tap'}</li>
              <li>{es ? 'Lectura en voz alta con voces japonesas' : 'Read aloud with Japanese voices'}</li>
              <li>{es ? 'Repasos SRS de tu propio vocabulario' : 'SRS reviews of your own vocabulary'}</li>
            </ul>
            <div className="guide-actions">
              <button type="button" className="guide-primary" onClick={goNext}>{es ? 'Empezar' : 'Get started'}</button>
              {/*
                Antes había aquí un «¿Ya usabas Yoru? Restaurar una copia» que saltaba
                a la pantalla de perfil, donde estaba el importador. Esa pantalla ya no
                existe, y la restauración vive en Ajustes → Respaldo, que es su sitio:
                se puede necesitar cualquier día, no solo el primero.
              */}
              <button type="button" className="guide-link" onClick={terminar}>
                {es ? 'Saltar la guía' : 'Skip the guide'}
              </button>
            </div>
          </div>
        ) : (
          <div className="guide-step">
            <div className="guide-top">
              <button type="button" className="guide-icon-btn" onClick={goPrev} aria-label={es ? 'Atrás' : 'Back'}><ChevronLeft size={22} /></button>
              <GuideDots count={lastGuideStep} index={step - 1} onSelect={(i) => setStep(i + 1)} lang={guideLang} />
              {step < lastGuideStep ? (
                <button type="button" className="guide-skip" onClick={() => setStep(lastGuideStep)}>{es ? 'Saltar' : 'Skip'}</button>
              ) : <span className="guide-skip-spacer" />}
            </div>
            {step <= slides.length ? (
              <SlideView slide={slides[step - 1]} />
            ) : (
              <div className="guide-slide">
                <h2 className="guide-title">{dictionary.complete ? (es ? 'Diccionario listo' : 'Dictionary ready') : (es ? 'Instala el diccionario' : 'Install the dictionary')}</h2>
                <DictionaryStep lang={guideLang} state={dictionary} />
              </div>
            )}
            <div className="guide-bottom">
              <button type="button" className="guide-primary" onClick={goNext}>
                {step < lastGuideStep
                  ? (es ? 'Siguiente' : 'Next')
                  : dictionary.hasDictionary || dictionary.installing ? (es ? 'Empezar a leer' : 'Start reading') : (es ? 'Ahora no, empezar a leer' : 'Not now, start reading')}
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
        {confirmModal}
      </div>
    );
  }

  /*
    Aqui estaba la pantalla de «crea tu perfil»: avatar, nombre y «Empezar a leer».
    Ya no existe. El perfil se hace solo con el nombre y la foto de Discord en cuanto
    se entra (ver `perfilDesdeDiscord` y el efecto de `App.tsx`), asi que preguntar un
    nombre a quien acaba de decirnos el suyo era pedir dos veces lo mismo.

    Lo que vivia solo en esa pantalla y no se ha perdido: restaurar una copia sigue en
    Ajustes → Respaldo, y entrar con Google en Ajustes → Sincronizacion.
  */
  return null;
}
