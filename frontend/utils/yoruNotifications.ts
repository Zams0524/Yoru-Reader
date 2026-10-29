import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import stableManifest from '../../stable.json';
import { db } from './db';
import { forecastSrsDue, lastStudyDay } from './srsForecast';

/**
 * Android notifications (YoruNotificationsPlugin, APK 1.5.0+): the read-aloud player in the
 * notification, the daily SRS reminder and the update notices. Everything here is a no-op on
 * desktop and on older APKs.
 */

export type ReadAloudControl = 'play' | 'pause' | 'next' | 'previous' | 'sleep' | 'close' | 'seek';
export type LaunchAction = 'srs' | 'updates';
type PermissionStatus = 'granted' | 'denied' | 'prompt';

export interface ReadAloudPlayerState {
  bookTitle: string;
  chapter: string;
  sentence: string;
  showSentence: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  note: string;
  lang: string;
  /** A data: URL; sent once per book (the player keeps it). */
  artwork?: string;
}

interface SrsReminderEntry { at: number; title: string; body: string }

interface YoruNotificationsPlugin {
  checkPermissions(): Promise<{ notifications: PermissionStatus }>;
  requestPermissions(): Promise<{ notifications: PermissionStatus }>;
  openNotificationSettings(): Promise<void>;
  getLaunchAction(): Promise<{ action: LaunchAction | null }>;
  updateReadAloud(state: ReadAloudPlayerState): Promise<void>;
  stopReadAloud(): Promise<void>;
  setSrsReminders(options: { entries: SrsReminderEntry[]; lang: string }): Promise<void>;
  clearSrsNotification(): Promise<void>;
  configureUpdates(options: { apk: boolean; ota: boolean; webVersion: string; lang: string }): Promise<void>;
  addListener(event: 'readAloudAction', listener: (event: { action: ReadAloudControl; positionMs: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'launchAction', listener: (event: { action: LaunchAction }) => void): Promise<PluginListenerHandle>;
}

export const YoruNotifications = registerPlugin<YoruNotificationsPlugin>('YoruNotifications');

export const hasYoruNotifications = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('YoruNotifications');

// ---- Settings (profile settings; Android only) ----

export const notificationSettings = (settings: any) => ({
  readAloudBackground: settings?.notifyReadAloudBackground !== false,
  readAloudSentence: settings?.notifyReadAloudSentence !== false,
  srsDaily: settings?.notifySrsDaily !== false,
  srsHour: Number.isFinite(Number(settings?.notifySrsHour)) ? Math.min(23, Math.max(0, Math.floor(Number(settings.notifySrsHour)))) : 9,
  appUpdates: settings?.notifyAppUpdates !== false,
  otaUpdates: settings?.notifyOtaUpdates === true,
});

// ---- Permission ----

const ASKED_KEY = 'yoru_notifications_asked';

export async function getNotificationPermission(): Promise<PermissionStatus> {
  if (!hasYoruNotifications()) return 'denied';
  try {
    return (await YoruNotifications.checkPermissions()).notifications;
  } catch {
    return 'denied';
  }
}

/**
 * Asks Android for notifications the first time Yoru needs them (Android 13+ shows its dialog
 * once). `force` asks again even if asked before (the user turned a notice on in the settings).
 */
export async function ensureNotificationPermission(force = false): Promise<boolean> {
  const status = await getNotificationPermission();
  if (status === 'granted') return true;
  if (status !== 'prompt') return false;
  let asked = false;
  try { asked = localStorage.getItem(ASKED_KEY) === '1'; } catch { /* ignore */ }
  if (asked && !force) return false;
  try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* ignore */ }
  try {
    return (await YoruNotifications.requestPermissions()).notifications === 'granted';
  } catch {
    return false;
  }
}

// ---- SRS reminder ----

const FORECAST_DAYS = 7;

function srsReminderText(lang: string, forecast: ReturnType<typeof forecastSrsDue>, idleDays: number) {
  const es = lang === 'es';
  const { total, fresh } = forecast;
  const toReview = forecast.reviews + forecast.learning;
  const minutes = Math.max(1, Math.round((toReview * 10 + fresh * 25) / 60));
  const cards = (n: number) => (es ? `${n} ${n === 1 ? 'tarjeta' : 'tarjetas'}` : `${n} ${n === 1 ? 'card' : 'cards'}`);
  const about = es ? `Unos ${minutes} minutos.` : `About ${minutes} min.`;
  if (idleDays >= 2) {
    return {
      title: es ? `Tienes ${cards(total)} esperando` : `${cards(total)} waiting for you`,
      body: es ? `Llevas ${idleDays} días sin repasar. ${about}` : `${idleDays} days since your last review. ${about}`,
    };
  }
  const parts: string[] = [];
  if (toReview > 0) parts.push(es ? `${toReview} para repasar` : `${toReview} to review`);
  if (fresh > 0) {
    let line = es ? `${fresh} ${fresh === 1 ? 'nueva' : 'nuevas'} de tu minado` : `${fresh} new from your mining`;
    const words = forecast.newWords.filter(Boolean);
    if (words.length) line += es ? `, entre ellas ${words.join(' y ')}` : `, like ${words.join(' and ')}`;
    parts.push(line);
  }
  return {
    title: es ? `Nuevo día de repaso: ${cards(total)}` : `New review day: ${cards(total)}`,
    body: `${parts.join(es ? ' y ' : ' and ')}. ${about}`,
  };
}

/**
 * Hands Android the reminders for the coming days at the chosen hour, each with the cards that
 * will be waiting then if nothing is reviewed before (so a skipped day shows what piled up).
 * Run again whenever the app opens or goes to the background, which picks up reviews done.
 * Also removes the reminder on screen once nothing is due any more.
 */
export async function refreshSrsReminders(settings: any): Promise<void> {
  if (!hasYoruNotifications()) return;
  const lang = settings?.appLanguage === 'en' ? 'en' : 'es';
  const options = notificationSettings(settings);
  const srsData = db.getSrsData();
  const statuses = db.getWordStatuses();
  const history = db.getSrsHistory();
  const dailyStats = db.getSrsDailyReviewStats();
  const now = new Date();

  if (forecastSrsDue(now, srsData, statuses, settings, history, dailyStats).total === 0) {
    await YoruNotifications.clearSrsNotification().catch(() => {});
  }
  if (!options.srsDaily) {
    await YoruNotifications.setSrsReminders({ entries: [], lang }).catch(() => {});
    return;
  }

  const lastDay = lastStudyDay(history);
  const entries: SrsReminderEntry[] = [];
  for (let offset = 0; offset < FORECAST_DAYS; offset++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, options.srsHour, 0, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const forecast = forecastSrsDue(at, srsData, statuses, settings, history, dailyStats);
    if (forecast.total === 0) continue;
    // Whole days between the last review and the reminder's day.
    let idleDays = 0;
    if (lastDay) {
      const [y, m, d] = lastDay.split('-').map(Number);
      const last = new Date(y, m - 1, d);
      const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
      idleDays = Math.round((day.getTime() - last.getTime()) / 86_400_000);
    }
    entries.push({ at: at.getTime(), ...srsReminderText(lang, forecast, idleDays) });
  }
  await YoruNotifications.setSrsReminders({ entries, lang }).catch(() => {});
}

// ---- Updates ----

export async function configureUpdateNotices(settings: any): Promise<void> {
  if (!hasYoruNotifications()) return;
  const options = notificationSettings(settings);
  await YoruNotifications.configureUpdates({
    apk: options.appUpdates,
    ota: options.otaUpdates,
    webVersion: stableManifest.hotUpdateVersion || '',
    lang: settings?.appLanguage === 'en' ? 'en' : 'es',
  }).catch(() => {});
}

// ---- Book cover for the player ----

const artworkCache = new Map<string, Promise<string | undefined>>();

/** The book cover as a small JPEG data URL for the player, or undefined (the app icon is used). */
export function playerArtwork(bookId: string, cover: string | undefined): Promise<string | undefined> {
  if (!cover || cover.startsWith('linear-gradient')) return Promise.resolve(undefined);
  const cached = artworkCache.get(bookId);
  if (cached) return cached;
  const promise = new Promise<string | undefined>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = cover;
  });
  artworkCache.set(bookId, promise);
  return promise;
}
