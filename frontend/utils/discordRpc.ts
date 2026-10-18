import { db } from './db';

let readingStartTime: number | null = null;
let currentBookId: string | null = null;
let sessionStartChars = 0;

const DEFAULT_ICON_URL = 'https://raw.githubusercontent.com/Zams0524/Yoru-Reader/main/icon.png';

function getLargeImageKey(discordIcon?: string): string {
  const icon = (discordIcon || 'yoru').toLowerCase();
  if (icon === 'cute') return 'gsm_cute';
  if (icon === 'jacked') return 'gsm_jacked';
  if (icon === 'cursed') return 'gsm_cursed';
  return 'icon'; // Official Art Asset name registered in Discord Developer Portal
}

function buildPresence(details: string, state: string, largeImageKey: string, startTimestamp?: number, lang: 'es' | 'en' = 'en'): any {
  const isEs = lang === 'es';
  const presence: any = {
    details: details ? details.substring(0, 127) : undefined,
    state: state ? state.substring(0, 127) : undefined,
    assets: {
      large_image: largeImageKey,
      large_text: 'Yoru Reader - Japanese Immersion'
    },
    buttons: [
      { label: isEs ? 'Ver Yoru Reader' : 'Get Yoru Reader', url: 'https://github.com/Zams0524/Yoru-Reader' }
    ]
  };

  if (startTimestamp) {
    presence.timestamps = {
      start: Math.floor(startTimestamp)
    };
  }

  return presence;
}

export function updateDiscordReading(book: any, settings: any, currentProgress?: any) {
  if (!window.electronAPI || !window.electronAPI.updateDiscordPresence) return;
  if (!settings.discordEnabled) {
    window.electronAPI.updateDiscordPresence(null);
    return;
  }

  const lang = settings.appLanguage || 'en';
  const isEs = lang === 'es';

  // Check blacklist
  if (settings.discordBlacklist && book?.title) {
    const blacklist = settings.discordBlacklist.split('\n').map((line: string) => line.trim().toLowerCase());
    if (blacklist.includes(book.title.toLowerCase())) {
      window.electronAPI.updateDiscordPresence(null);
      return;
    }
  }

  if (currentBookId !== book.id) {
    currentBookId = book.id;
    readingStartTime = Date.now();
    sessionStartChars = currentProgress && currentProgress.currChars !== undefined
      ? currentProgress.currChars
      : (book.progress?.charactersRead || 0);
  }

  if (!readingStartTime) {
    readingStartTime = Date.now();
  }

  const details = isEs ? `Leyendo: ${book.title}` : `Reading: ${book.title}`;
  const currChapterIdx = currentProgress && currentProgress.currSection !== undefined
    ? currentProgress.currSection
    : (book.progress?.currentChapter ?? 0);
  const chapter = book.chapters?.[currChapterIdx];
  let state = chapter ? chapter.title : (isEs ? 'Novela ligera' : 'Light Novel');

  if (settings.discordShowStats === 'Progress') {
    const percent = currentProgress && currentProgress.totalChars > 0
      ? Math.round((currentProgress.currChars / currentProgress.totalChars) * 100)
      : (book.progress?.percent ?? 0);
    state = `${state} (${percent}%)`;
  } else if (settings.discordShowStats === 'Characters per Hour') {
    const liveCharsRead = currentProgress && currentProgress.currChars !== undefined
      ? currentProgress.currChars
      : (book.progress?.charactersRead || 0);
    const sessionChars = Math.max(0, liveCharsRead - sessionStartChars);
    const elapsedHours = readingStartTime ? (Date.now() - readingStartTime) / (1000 * 60 * 60) : 0;
    const charsPerHour = elapsedHours > 0.005 ? Math.round(sessionChars / elapsedHours) : 0;
    state = `${state} (${charsPerHour} ${isEs ? 'car/h' : 'chars/h'})`;
  } else if (settings.discordShowStats === 'Total Characters') {
    const liveCharsRead = currentProgress && currentProgress.currChars !== undefined
      ? currentProgress.currChars
      : (book.progress?.charactersRead || 0);
    state = `${state} (${liveCharsRead} ${isEs ? 'car.' : 'chars'})`;
  } else if (settings.discordShowStats === 'Cards Mined') {
    try {
      const srsData = db.getSrsData();
      const cardsMined = Object.keys(srsData).filter(key => !key.startsWith('_')).length;
      state = `${state} (${cardsMined} ${isEs ? 'tarj.' : 'cards'})`;
    } catch (e) {
      console.error('Error fetching cards mined count for Discord:', e);
    }
  } else if (settings.discordShowStats === 'Active Reading Time') {
    state = `${state} (${isEs ? 'Leyendo' : 'Reading'})`;
  }

  const largeImageKey = getLargeImageKey(settings.discordIcon);
  const showTime = settings.discordShowStats !== 'None';
  const presence = buildPresence(
    details,
    state,
    largeImageKey,
    readingStartTime || Date.now(),
    lang
  );

  window.electronAPI.updateDiscordPresence(presence);
}

export function updateDiscordReview(settings: any) {
  if (!window.electronAPI || !window.electronAPI.updateDiscordPresence) return;
  if (!settings.discordEnabled) {
    window.electronAPI.updateDiscordPresence(null);
    return;
  }

  const lang = settings.appLanguage || 'en';
  const isEs = lang === 'es';
  const largeImageKey = getLargeImageKey(settings.discordIcon);
  const presence = buildPresence(
    isEs ? 'Repasando tarjetas' : 'Reviewing Flashcards',
    isEs ? 'Sesión de SRS (FSRS-6)' : 'SRS Review Session (FSRS-6)',
    largeImageKey,
    Date.now(),
    lang
  );

  window.electronAPI.updateDiscordPresence(presence);
}

export function clearDiscordPresence() {
  if (!window.electronAPI || !window.electronAPI.updateDiscordPresence) return;
  window.electronAPI.updateDiscordPresence(null);
  currentBookId = null;
  readingStartTime = null;
}

export function updateDiscordLibrary(settings: any) {
  if (!window.electronAPI || !window.electronAPI.updateDiscordPresence) return;
  if (!settings.discordEnabled) {
    window.electronAPI.updateDiscordPresence(null);
    return;
  }

  const lang = settings.appLanguage || 'en';
  const isEs = lang === 'es';
  const largeImageKey = getLargeImageKey(settings.discordIcon);
  const presence = buildPresence(
    isEs ? 'En la biblioteca' : 'In Library',
    isEs ? 'Explorando novelas' : 'Browsing Japanese Books',
    largeImageKey,
    undefined,
    lang
  );

  window.electronAPI.updateDiscordPresence(presence);
}
