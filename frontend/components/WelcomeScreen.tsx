import React, { useState, useRef, useEffect } from 'react';
import { Camera, User, Globe } from 'lucide-react';
import { t } from '../utils/i18n';
import JSZip from 'jszip';
import { db } from '../utils/db';
import { authorizeGoogleDriveNative, googleDriveService, DEFAULT_GDRIVE_CLIENT_ID, DEFAULT_GDRIVE_CLIENT_SECRET, GDRIVE_ANDROID_CLIENT_ID } from '../utils/googleDriveService';
import { Capacitor } from '@capacitor/core';
import { useConfirm } from './ConfirmModal';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DictionaryStep, GuideDots, SlideView, featureSlides, useArrowKeys, useDictionaryInstall, useSwipe } from './onboarding/GuideSlides';

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
  onCreateProfile: (profile: any) => void;
  settings: any;
  onSaveSettings: (settings: any) => void;
}

export default function WelcomeScreen({ onCreateProfile, settings = {}, onSaveSettings }: WelcomeScreenProps) {
  const lang = settings.appLanguage || 'en';
  const [name, setName] = useState('');
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

  const handleRestoreDriveBackup = async () => {
    const defaultClientId = DEFAULT_GDRIVE_CLIENT_ID;
    const defaultClientSecret = DEFAULT_GDRIVE_CLIENT_SECRET;

    const clientId = localStorage.getItem('gdrive_client_id') !== null ? localStorage.getItem('gdrive_client_id')! : defaultClientId;
    const clientSecret = localStorage.getItem('gdrive_client_secret') !== null ? localStorage.getItem('gdrive_client_secret')! : defaultClientSecret;

    try {
      setIsSyncing(true);
      document.body.style.cursor = 'wait';

      if (Capacitor.getPlatform() === 'android') {
        const androidClientId = GDRIVE_ANDROID_CLIENT_ID;
        const tokens = await authorizeGoogleDriveNative();
        localStorage.setItem('gdrive_client_id', androidClientId);
        localStorage.removeItem('gdrive_client_secret');
        localStorage.setItem('gdrive_tokens', JSON.stringify(tokens));

        const info = await googleDriveService.getUserInfo(tokens, androidClientId, '');
        localStorage.setItem('gdrive_user_email', info.email);
        const zipBlob = await googleDriveService.downloadBlobFile(
          tokens, androidClientId, 'yoru_reader_full_backup.zip', ''
        );
        if (!zipBlob) {
          showToast(lang === 'es'
            ? 'No se encontró ningún archivo de copia de seguridad (yoru_reader_full_backup.zip) en Google Drive.'
            : 'No backup file (yoru_reader_full_backup.zip) was found in your Google Drive.', 'error');
          return;
        }
        const fileObj = new File([zipBlob], 'yoru_reader_full_backup.zip', { type: 'application/zip' });
        await handleImportLocalBackup({ target: { files: [fileObj] } });
        return;
      }

      if (!window.electronAPI || !window.electronAPI.startGoogleOauth) {
        throw new Error(lang === 'es'
          ? 'La restauración de Google Drive solo está disponible en la app de Android o de escritorio.'
          : 'Google Drive restore is only available in the Android or desktop app.');
      }

      localStorage.setItem('gdrive_client_id', clientId.trim());
      localStorage.setItem('gdrive_client_secret', clientSecret.trim());

      // 1. Authenticate / get tokens
      setCanCancelDriveAuth(true);
      const oauthResult = await window.electronAPI.startGoogleOauth(clientId.trim());
      setCanCancelDriveAuth(false);
      if (!oauthResult || !oauthResult.code) {
        throw new Error('No authorization code returned from loopback server');
      }

      const tokens = await googleDriveService.exchangeCodeForTokens(
        oauthResult.code,
        oauthResult.redirectUri,
        clientId.trim(),
        clientSecret.trim(),
        oauthResult.codeVerifier
      );

      if (!tokens) {
        showToast(lang === 'es' ? 'Error al conectar con Google Drive.' : 'Failed to connect to Google Drive.', 'error');
        return;
      }

      localStorage.setItem('gdrive_tokens', JSON.stringify(tokens));

      // Fetch connected user info
      const info = await googleDriveService.getUserInfo(tokens, clientId.trim(), clientSecret.trim());
      localStorage.setItem('gdrive_user_email', info.email);

      // 2. Download backup zip from Drive
      const zipBlob = await googleDriveService.downloadBlobFile(
        tokens,
        clientId.trim(),
        'yoru_reader_full_backup.zip',
        clientSecret.trim()
      );

      if (!zipBlob) {
        showToast(lang === 'es'
          ? 'No se encontró ningún archivo de copia de seguridad (yoru_reader_full_backup.zip) en Google Drive.'
          : 'No backup file (yoru_reader_full_backup.zip) was found in your Google Drive.', 'error');
        return;
      }

      // Convert Blob to File object to reuse local import logic
      const fileObj = new File([zipBlob], 'yoru_reader_full_backup.zip', { type: 'application/zip' });
      await handleImportLocalBackup({ target: { files: [fileObj] } });

    } catch (e: any) {
      console.error(e);
      if (!String(e?.message || '').toLowerCase().includes('cancelled')) {
        showToast((lang === 'es' ? 'Error al restaurar desde Drive: ' : 'Error restoring from Drive: ') + e.message, 'error');
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let avatar = '';
    let emoji = '';

    if (customAvatarUrl) {
      avatar = customAvatarUrl;
    } else {
      avatar = PRESET_AVATARS[selectedPresetIdx].avatar;
      emoji = PRESET_AVATARS[selectedPresetIdx].emoji;
    }

    const newProfile = {
      id: `profile-${Date.now()}`,
      name: name.trim(),
      avatar: avatar,
      avatarEmoji: emoji
    };

    localStorage.setItem('yoru_tutorial_seen_v1', 'true');
    onCreateProfile(newProfile);
  };

  // First-run guide: welcome → 4 feature slides → dictionary → profile (the form below).
  const slides = featureSlides(lang === 'es' ? 'es' : 'en');
  const guideLang: 'es' | 'en' = lang === 'es' ? 'es' : 'en';
  const [step, setStep] = useState(0);
  const lastGuideStep = slides.length + 1; // 0 welcome, 1..4 slides, 5 dictionary, 6 profile
  const dictionary = useDictionaryInstall(guideLang);
  const goNext = () => setStep((value) => Math.min(lastGuideStep + 1, value + 1));
  const goPrev = () => setStep((value) => Math.max(0, value - 1));
  const swipe = useSwipe(() => { if (step > 0 && step <= lastGuideStep && !dictionary.installing) goNext(); }, () => { if (step > 0 && step <= lastGuideStep) goPrev(); });
  const es = lang === 'es';
  useArrowKeys(
    () => { if (step <= lastGuideStep && !dictionary.installing) goNext(); },
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
            <ul className="guide-points">
              <li>{es ? 'Diccionario al tocar cualquier palabra' : 'A dictionary on every word you tap'}</li>
              <li>{es ? 'Lectura en voz alta con voces japonesas' : 'Read aloud with Japanese voices'}</li>
              <li>{es ? 'Repasos SRS de tu propio vocabulario' : 'SRS reviews of your own vocabulary'}</li>
            </ul>
            <div className="guide-actions">
              <button type="button" className="guide-primary" onClick={goNext}>{es ? 'Empezar' : 'Get started'}</button>
              <button type="button" className="guide-link" onClick={() => setStep(lastGuideStep + 1)}>
                {es ? '¿Ya usabas Yoru? Restaurar una copia' : 'Used Yoru before? Restore a backup'}
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
                <h2 className="guide-title">{dictionary.hasDictionary ? (es ? 'Diccionario listo' : 'Dictionary ready') : (es ? 'Instala el diccionario' : 'Install the dictionary')}</h2>
                <DictionaryStep lang={guideLang} state={dictionary} />
              </div>
            )}
            <div className="guide-bottom">
              <button type="button" className="guide-primary" onClick={goNext} disabled={dictionary.installing}>
                {step < lastGuideStep
                  ? (es ? 'Siguiente' : 'Next')
                  : dictionary.hasDictionary ? (es ? 'Crear mi perfil' : 'Create my profile') : (es ? 'Ahora no, crear perfil' : 'Not now, create profile')}
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
        {confirmModal}
      </div>
    );
  }

  return (
    <div className="welcome-screen-container">
      <div className="welcome-card">
        {/* Header toolbar: Language Switcher & Theme Switcher */}
        <button type="button" className="guide-link welcome-back-link" onClick={() => setStep(lastGuideStep)}>
          ← {es ? 'Volver a la guía' : 'Back to the guide'}
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          {/* Language Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Globe size={14} style={{ color: 'var(--text-muted)' }} />
            <select 
              value={lang}
              onChange={(e) => {
                const selectedLang = e.target.value;
                localStorage.setItem('app_language', selectedLang);
                onSaveSettings({ ...settings, appLanguage: selectedLang });
              }}
              className="migaku-select"
              style={{ 
                width: '110px', 
                fontSize: '0.78rem', 
                padding: '5px 8px', 
                background: 'var(--bg-app)', 
                border: '1px solid var(--border-light)', 
                borderRadius: '6px', 
                color: 'var(--text-main)', 
                outline: 'none' 
              }}
            >
              <option value="en">English (US)</option>
              <option value="es">Español</option>
            </select>
          </div>

          {/* Theme Switcher */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-light)', padding: '3px', borderRadius: '8px' }}>
            {['light', 'sepia', 'dark'].map((tMode) => {
              const isActive = (settings.theme || 'dark') === tMode;
              const modeLabel = tMode === 'light' ? (lang === 'es' ? 'Claro' : 'Light') : (tMode === 'sepia' ? (lang === 'es' ? 'Sepia' : 'Sepia') : (lang === 'es' ? 'Oscuro' : 'Dark'));
              const emoji = tMode === 'light' ? '☀️' : (tMode === 'sepia' ? '📜' : '🌙');
              const activeBg = 'var(--primary)';
              const activeColor = tMode === 'dark' ? '#000000' : '#ffffff';
              
              return (
                <button
                  key={tMode}
                  type="button"
                  onClick={() => onSaveSettings({ ...settings, theme: tMode })}
                  style={{
                    border: 'none',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: isActive ? activeBg : 'transparent',
                    color: isActive ? activeColor : 'var(--text-muted)'
                  }}
                  title={modeLabel}
                >
                  {emoji} {modeLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div className="welcome-header">
          <h1 className="welcome-title">{t('welcomeTitle', lang)}</h1>
          <p className="welcome-subtitle">{t('welcomeSubtitle', lang)}</p>
        </div>

        <form onSubmit={handleSubmit} className="welcome-form">
          {/* Avatar Preview & Upload */}
          <div className="welcome-avatar-section">
            <div className="welcome-avatar-preview-wrapper">
              <input 
                type="file" 
                accept="image/*" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                style={{ display: 'none' }} 
              />
              
              {customAvatarUrl ? (
                <div 
                  className="welcome-avatar-preview custom"
                  onClick={() => fileInputRef.current?.click()}
                  title={lang === 'es' ? 'Cambiar foto de perfil' : 'Change profile photo'}
                >
                  <img src={customAvatarUrl} alt="Avatar" className="welcome-custom-img" />
                  <div className="welcome-avatar-overlay">
                    <Camera size={16} />
                  </div>
                </div>
              ) : (
                <div 
                  className="welcome-avatar-preview preset"
                  style={{ background: PRESET_AVATARS[selectedPresetIdx].avatar }}
                  onClick={() => fileInputRef.current?.click()}
                  title={lang === 'es' ? 'Subir foto personalizada' : 'Upload custom photo'}
                >
                  <span className="welcome-avatar-emoji">
                    {PRESET_AVATARS[selectedPresetIdx].emoji}
                  </span>
                  <div className="welcome-avatar-overlay">
                    <Camera size={16} />
                  </div>
                </div>
              )}
            </div>
            <button 
              type="button" 
              className="welcome-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              {t('uploadPhoto', lang)}
            </button>
          </div>

          {/* Preset Avatars Selection */}
          <div className="welcome-presets-section">
            <div className="welcome-presets-label">{t('chooseAvatar', lang)}</div>
            <div className="welcome-presets-grid">
              {PRESET_AVATARS.map((p, idx) => {
                const isSelected = selectedPresetIdx === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`welcome-preset-item ${isSelected ? 'selected' : ''}`}
                    style={{ background: p.avatar }}
                    onClick={() => {
                      setSelectedPresetIdx(idx);
                      setCustomAvatarUrl(null);
                    }}
                  >
                    <span>{p.emoji}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name Input */}
          <div className="welcome-input-group">
            <label className="welcome-input-label">{t('profileName', lang)}</label>
            <div className="welcome-input-wrapper">
              <User className="welcome-input-icon" size={16} />
              <input 
                type="text" 
                placeholder={t('namePlaceholder', lang)} 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="welcome-name-input"
                maxLength={20}
                required
                autoFocus
              />
            </div>
          </div>

          <button type="submit" className="welcome-submit-btn">
            {t('startReading', lang)}
          </button>
        </form>

        <div style={{ margin: '16px 0 12px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {lang === 'es' ? '¿Tienes una copia?' : 'Have a backup?'}
          </span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {/* hidden input for local restore */}
          <input 
            type="file" 
            ref={localBackupInputRef}
            accept=".json,.zip"
            onChange={handleImportLocalBackup}
            style={{ display: 'none' }}
          />

          {/* Restaurar Local */}
          <button 
            type="button"
            onClick={() => localBackupInputRef.current?.click()}
            className="welcome-submit-btn" 
            style={{ 
              flex: 1,
              background: 'var(--bg-app)', 
              border: '1px solid var(--border-light)', 
              color: 'var(--text-main)', 
              fontSize: '0.78rem', 
              padding: '10px 12px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '6px', 
              cursor: 'pointer',
              textTransform: 'none',
              boxShadow: 'none',
              margin: 0,
              borderRadius: '8px',
              fontWeight: 600
            }}
          >
            💾 {lang === 'es' ? 'Local' : 'Local'}
          </button>

          {/* Restaurar Google Drive */}
          <button 
            type="button"
            onClick={canCancelDriveAuth ? cancelDriveSignIn : handleRestoreDriveBackup}
            disabled={isSyncing && !canCancelDriveAuth}
            className="welcome-submit-btn" 
            style={{ 
              flex: 1,
              background: driveBg, 
              border: driveBorder, 
              color: driveColor, 
              fontSize: '0.78rem', 
              padding: '10px 12px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '6px', 
              cursor: 'pointer',
              textTransform: 'none',
              boxShadow: 'none',
              margin: 0,
              borderRadius: '8px',
              fontWeight: 600
            }}
          >
            ☁️ {isSyncing 
              ? canCancelDriveAuth
                ? (lang === 'es' ? 'Cancelar inicio de sesión' : 'Cancel sign-in')
                : (lang === 'es' ? 'Restaurando...' : 'Restoring...')
              : (lang === 'es' ? 'Google Drive' : 'Google Drive')}
          </button>
        </div>
      </div>
    {/* Custom Toast Notification Styled with App Theme */}
      {toast.show && (
        <div className="yoru-toast" style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: '#18181b',
          color: '#ffffff',
          padding: '10px 16px',
          borderRadius: '4px',
          border: toast.type === 'success' ? '1px solid #34d399' : '1px solid #ef4444',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          fontFamily: 'system-ui, sans-serif',
          fontSize: '0.82rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'toastIn 0.2s ease-out forwards'
        }}>
          <span style={{ 
            width: '6px', 
            height: '6px', 
            borderRadius: '50%', 
            background: toast.type === 'success' ? '#34d399' : '#ef4444',
            display: 'inline-block' 
          }} />
          <span>{toast.message}</span>
        </div>
      )}
      {confirmModal}
    </div>
  );
}
