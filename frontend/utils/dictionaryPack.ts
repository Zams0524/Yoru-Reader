import { IDLE, publish } from './dictionaryPackProgress';
import { deleteDictionary, getInstalledDictionaries, installBundledDictionary, isBundledInstallRunning } from './yomitanDB';

/**
 * The recommended set every reader needs: a JMdict in the app's language, a frequency list
 * (the "how common" stars in the popup) and pitch accent. All three ship inside the app, so one
 * tap installs them offline. The install runs in the background; any screen can follow it with
 * subscribePackProgress (the app-wide toast does).
 */

export type PackItemId = 'dictionary' | 'frequency' | 'pitch';
type Lang = 'es' | 'en';

export interface PackItem {
  id: PackItemId;
  asset: string;
  label: string;
}


const PITCH = /pitch|アクセント/i;
const FREQUENCY = /frequen|frecuencia|meta|Netflix|YouTube|novels|anime|visual novel|VN Freq/i;

export const isPitchDictionary = (dictionary: any) => PITCH.test(dictionary?.title || '');
export const isTermDictionary = (dictionary: any) => {
  if (dictionary?.hasTerms === true) return true;
  if (dictionary?.hasTerms === false || dictionary?.hasFreqs === true) return false;
  return !PITCH.test(dictionary?.title || '') && !FREQUENCY.test(dictionary?.title || '');
};
export const isFrequencyDictionary = (dictionary: any) => {
  if (isPitchDictionary(dictionary) || isTermDictionary(dictionary)) return false;
  return dictionary?.hasFreqs === true || FREQUENCY.test(dictionary?.title || '');
};

export function packItems(lang: Lang): PackItem[] {
  const es = lang === 'es';
  return [
    {
      id: 'dictionary',
      asset: es ? 'JMdict_spanish.zip' : 'JMdict_english.zip',
      label: es ? 'Diccionario japonés → español (JMdict)' : 'Japanese → English dictionary (JMdict)'
    },
    { id: 'frequency', asset: 'frequency-novels.zip', label: es ? 'Frecuencia de palabras (novelas)' : 'Word frequency (novels)' },
    { id: 'pitch', asset: 'pitch-accent-japanese.zip', label: es ? 'Acento tonal' : 'Pitch accent' },
  ];
}

/** Which parts of the recommended set are installed (any dictionary of that kind counts). */
export function packStatus(installed: any[]): Record<PackItemId, boolean> {
  const ready = (installed || []).filter(dictionary => dictionary.importState !== 'installing');
  return {
    dictionary: ready.some(isTermDictionary),
    frequency: ready.some(isFrequencyDictionary),
    pitch: ready.some(isPitchDictionary),
  };
}

/** Installs whatever is missing from the recommended set. Calls while it runs share the same job. */
let running: Promise<void> | null = null;

export function installRecommendedPack(lang: Lang, only?: PackItemId[]): Promise<void> {
  if (running) return running;
  running = (async () => {
    let installed = await getInstalledDictionaries();
    // An import cut short (app closed mid-install) leaves a half-filled dictionary: start it over.
    const interrupted = installed.filter(dictionary => dictionary.importState === 'installing');
    if (interrupted.length > 0 && !isBundledInstallRunning()) {
      for (const dictionary of interrupted) await deleteDictionary(dictionary.title);
      installed = await getInstalledDictionaries();
    }
    const status = packStatus(installed);
    const missing = packItems(lang).filter(item => !status[item.id] && (!only || only.includes(item.id)));
    if (missing.length === 0) return;
    publish({ ...IDLE, running: true, total: missing.length });
    try {
      for (let index = 0; index < missing.length; index++) {
        const item = missing[index];
        publish({ step: index + 1, label: item.label, percent: Math.round((index / missing.length) * 100) });
        await installBundledDictionary(item.asset, lang, (_message, percent) => {
          publish({ percent: Math.round(((index + Math.min(100, percent) / 100) / missing.length) * 100) });
        });
      }
      publish({ running: false, done: true, percent: 100 });
    } catch (err: any) {
      publish({ running: false, error: err?.message || String(err) });
      throw err;
    }
  })().finally(() => { running = null; });
  return running;
}

export { dismissPackProgress, getPackProgress, subscribePackProgress, type PackProgress } from './dictionaryPackProgress';
