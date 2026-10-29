import React, { useState, useEffect } from 'react';
import { X, Database, Upload, Download, RefreshCw, FileText, BarChart3, AlertTriangle, ChevronRight, ChevronLeft, Layers, ListOrdered, Archive, Link2 } from 'lucide-react';
import { db } from '../utils/db';
import { tokenizeText } from '../utils/japanese';
import { useConfirm } from './ConfirmModal';
import { getInstalledDictionaries, getTopWordsFromFrequencyDict } from '../utils/yomitanDB';
import { ankiConnectRequest } from '../utils/ankiConnect';
import { isPhoneUI } from '../utils/platform';
import { chooseAnkiWordField, findReplacedAnkiCards, planAnkiImport, type AnkiImportCard, type AnkiImportPlan, type AnkiReview } from '../utils/ankiCardImport';
import type { ApkgStep } from '../utils/apkgImport';
import { srsWordOfKey } from '../utils/srsCardKeys';

type AnkiFieldValue = string | { value?: unknown } | null | undefined;
type AnkiCardInfo = {
  cardId?: number;
  note?: number;
  /** Anki queue: -1 suspended, -2/-3 buried, 0 new, 1 learning, 2 review, 3 day-learning. */
  queue?: number;
  deckName?: string;
  modelName?: string;
  interval?: number;
  reps?: number;
  lapses?: number;
  /** Anki's ease factor * 1000 (e.g. 2500 = 250%). */
  factor?: number;
  /** Anki card type: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  type?: number;
  /** New: queue position. Learning/Relearning: next-review time, epoch seconds. Review: days since the collection was created. */
  due?: number;
  /** Last-modified time, epoch seconds (used as an approximate last-review time). */
  mod?: number;
  fields?: Record<string, AnkiFieldValue>;
};

const getAnkiFieldValue = (fields: AnkiCardInfo['fields'], fieldName: string) => {
  const field = fields?.[fieldName];
  const value = typeof field === 'string' ? field : field?.value;
  return typeof value === 'string' ? value : value == null ? '' : String(value);
};

const preferredAnkiField = (fieldNames: string[], preferences: string[]) => {
  const byLowerName = new Map(fieldNames.map(name => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), name]));
  for (const preference of preferences) {
    const match = byLowerName.get(preference.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (match) return match;
  }
  return fieldNames[0] || '';
};

const normalizeAnkiText = (value: string) => value
  .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\[[^\]]*\]/g, '')
  .replace(/\([^)]*\)/g, '')
  .replace(/（[^）]*）/g, '')
  .replace(/\{[^}]*\}/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeFieldName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const READING_FIELD_PREFERENCES = ['reading', 'vocabulary-kana', 'kana', 'furigana'];

/** One Anki card before its word is picked: its fields as plain text, plus its scheduling data. */
type RawAnkiImportCard = { fields: Record<string, string>; base: Omit<AnkiImportCard, 'word' | 'reading'> };

interface VocabularyModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  initialImportMethod?: string;
}

export default function VocabularyModal({ 
  isOpen, 
  onClose, 
  initialTab = 'summary', 
  initialImportMethod = ''
}: VocabularyModalProps) {
  // AnkiConnect needs Anki running on the same computer, which a phone never has.
  const ankiConnectAvailable = !isPhoneUI();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [importMethod, setImportMethod] = useState(initialImportMethod === 'anki-connect' && !ankiConnectAvailable ? '' : initialImportMethod);
  
  const { showConfirm, confirmModal } = useConfirm();
  const lang = db.getSettings().appLanguage || 'en';

  // Stats
  const [stats, setStats] = useState({ total: 0, known: 0, learning: 0, starred: 0, ignored: 0 });

  // Anki settings
  const [ankiSettings, setAnkiSettings] = useState(() => {
    const saved = localStorage.getItem('anki_settings_v2');
    const defaults = {
      host: 'http://127.0.0.1:8765',
      apiKey: '',
      expression: { deck: 'sentence mining', noteType: '' },
      importWordField: '',
      importWordFieldManual: false,
      importReadingField: '',
      importMinInterval: 21,
      importParseWords: true,
      tags: ''
    };
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  });
  const [availableDecks, setAvailableDecks] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isCardsModalOpen, setIsCardsModalOpen] = useState(false);
  const [expressionFields, setExpressionFields] = useState<string[]>([]);
  const [importSourceModels, setImportSourceModels] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'error' | 'testing' | 'disconnected'>('disconnected');
  const [connectionError, setConnectionError] = useState('');

  // JPDB settings
  const [jpdbApiKey, setJpdbApiKey] = useState(() => localStorage.getItem('jpdb_api_key') || '');
  const [jpdbReviewsFile, setJpdbReviewsFile] = useState<File | null>(null);
  const [jpdbOverwrite, setJpdbOverwrite] = useState(true);

  // File import settings
  const [vocabFile, setVocabFile] = useState<File | null>(null);
  const [fileParseWords, setFileParseWords] = useState(true);

  // Frequency import settings
  const [availableFreqDicts, setAvailableFreqDicts] = useState<any[]>([]);
  const [selectedFreqDict, setSelectedFreqDict] = useState('');
  const [freqMaxRank, setFreqMaxRank] = useState(2000);

  // General state
  const [isLoading, setIsLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  // Load stats & dicts
  const loadVocabStats = () => {
    const wordStatuses = db.getWordStatuses();
    const list = Object.values(wordStatuses);
    setStats({
      total: list.length,
      known: list.filter(s => s === 'known').length,
      learning: list.filter(s => s === 'learning').length,
      starred: list.filter(s => s === 'starred').length,
      ignored: list.filter(s => s === 'ignored').length
    });
  };

  useEffect(() => {
    if (isOpen) {
      loadVocabStats();
      document.body.style.overflow = 'hidden';
      if (importMethod === 'anki-connect') {
        testAnkiConnection();
      }
      loadFrequencyDicts();
    } else {
      document.body.style.overflow = '';
    }
  }, [isOpen, importMethod]);

  const loadFrequencyDicts = async () => {
    try {
      const dicts = await getInstalledDictionaries();
      const freqs = dicts.filter(d => d.hasFreqs);
      setAvailableFreqDicts(freqs);
      if (freqs.length > 0 && !selectedFreqDict) {
        setSelectedFreqDict(freqs[0].title);
      }
    } catch (e) {
      console.warn('Failed to load frequency dictionaries:', e);
    }
  };

  // --- AnkiConnect Connect logic ---
  const testAnkiConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    try {
      const host = ankiSettings.host || 'http://127.0.0.1:8765';
      const auth = ankiSettings.apiKey ? { key: ankiSettings.apiKey } : {};
      const data = await ankiConnectRequest<number>(host, { action: 'version', version: 6, ...auth });
      if (data.result !== undefined && data.result !== null) {
        setConnectionStatus('connected');
        const [deckRes, modelRes] = await Promise.all([
          ankiConnectRequest<string[]>(host, { action: 'deckNames', version: 6, ...auth }),
          ankiConnectRequest<string[]>(host, { action: 'modelNames', version: 6, ...auth })
        ]);
        const deckData = deckRes;
        const modelData = modelRes;
        
        let updatedSettings = { ...ankiSettings };
        let settingsChanged = false;

        if (deckData.result) {
          setAvailableDecks(deckData.result);
          const currentDeck = ankiSettings.expression?.deck;
          if (deckData.result.length > 0 && (!currentDeck || !deckData.result.includes(currentDeck))) {
            updatedSettings = {
              ...updatedSettings,
              expression: {
                ...(updatedSettings.expression || {}),
                deck: deckData.result[0]
              }
            };
            settingsChanged = true;
          }
        }
        
        if (modelData.result) {
          setAvailableModels(modelData.result);
          const currentModel = ankiSettings.expression?.noteType;
          if (modelData.result.length > 0 && (!currentModel || !modelData.result.includes(currentModel))) {
            updatedSettings = {
              ...updatedSettings,
              expression: {
                ...(updatedSettings.expression || {}),
                noteType: modelData.result[0]
              }
            };
            settingsChanged = true;
          }
        }

        if (settingsChanged) {
          saveAnkiSettings(updatedSettings);
        }
      } else {
        setConnectionStatus('error');
      }
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    let active = true;
    async function fetchImportFields() {
      const deck = ankiSettings.expression?.deck;
      if (connectionStatus !== 'connected' || !deck) {
        setExpressionFields([]);
        setImportSourceModels([]);
        return;
      }
      try {
        const host = ankiSettings.host || 'http://127.0.0.1:8765';
        const auth = ankiSettings.apiKey ? { key: ankiSettings.apiKey } : {};
        const deckQuery = `deck:"${deck.replace(/"/g, '\\"')}"`;
        const cards = await ankiConnectRequest<number[]>(host, {
          action: 'findCards',
          version: 6,
          params: { query: deckQuery },
          ...auth
        });

        let fieldNames: string[] = [];
        let sourceModels: string[] = [];
        if (cards.result?.length) {
          const sample = await ankiConnectRequest<AnkiCardInfo[]>(host, {
            action: 'cardsInfo',
            version: 6,
            params: { cards: cards.result.slice(0, 25) },
            ...auth
          });
          const names = new Set<string>();
          const models = new Set<string>();
          for (const card of sample.result || []) {
            Object.keys(card.fields || {}).forEach(name => names.add(name));
            if (card.modelName) models.add(card.modelName);
          }
          fieldNames = Array.from(names);
          sourceModels = Array.from(models);
        }

        // An empty deck has no sample cards; use the configured note model as a
        // fallback so the controls remain usable until cards are added.
        if (fieldNames.length === 0 && ankiSettings.expression?.noteType) {
          const modelFields = await ankiConnectRequest<string[]>(host, {
            action: 'modelFieldNames',
            version: 6,
            params: { modelName: ankiSettings.expression.noteType },
            ...auth
          });
          fieldNames = modelFields.result || [];
          sourceModels = [ankiSettings.expression.noteType];
        }

        if (active) {
          setExpressionFields(fieldNames);
          setImportSourceModels(sourceModels);
          setAnkiSettings((prev: any) => {
            if (fieldNames.length === 0) return prev;
            const recommendedWordField = preferredAnkiField(fieldNames, ['vocabulary-kanji', 'vocabulary-kana', 'word', 'kanji', 'vocabulary', 'front', 'expression']);
            const hasDedicatedVocabularyField = fieldNames.some(name => /vocabulary|word|kanji/i.test(name));
            const selectedLooksLikeSentenceField = /sentence|example|context|cloze|expression/i.test(prev.importWordField || '');
            const shouldMigrateOldDefault = prev.importWordFieldManual !== true && hasDedicatedVocabularyField && selectedLooksLikeSentenceField;
            const wordField = fieldNames.includes(prev.importWordField) && !shouldMigrateOldDefault
              ? prev.importWordField
              : recommendedWordField;
            const readingField = !prev.importReadingField || fieldNames.includes(prev.importReadingField)
              ? prev.importReadingField
              : preferredAnkiField(fieldNames, ['reading', 'vocabulary-kana', 'kana', 'furigana']);
            if (wordField === prev.importWordField && readingField === prev.importReadingField && prev.importWordFieldManual !== undefined) return prev;
            const updated = { ...prev, importWordField: wordField, importWordFieldManual: false, importReadingField: readingField };
            localStorage.setItem('anki_settings_v2', JSON.stringify(updated));
            return updated;
          });
        }
      } catch (err) {
        console.warn('Failed to detect fields in the selected Anki deck:', err);
      }
    }
    fetchImportFields();
    return () => { active = false; };
  }, [connectionStatus, ankiSettings.expression?.deck, ankiSettings.expression?.noteType, ankiSettings.host, ankiSettings.apiKey]);

  const saveAnkiSettings = (newSetts: any) => {
    setAnkiSettings(newSetts);
    localStorage.setItem('anki_settings_v2', JSON.stringify(newSetts));
  };

  const cleanWord = (val: string) => {
    if (!val) return '';
    const s = normalizeAnkiText(val);
    const parts = s.split(/[\s\-:：|｜]/);
    return (parts[0] || '').trim();
  };

  /**
   * Picks each Anki card's word (and reading) from its fields. Every card becomes its own Yoru card,
   * even when another card has the same word, so the deck keeps Anki's card count. Sentence
   * fields, when "parse sentences" is on, are split into words instead (one card per word).
   */
  const collectAnkiImportCards = async (
    rawCards: RawAnkiImportCard[],
    options: { effectiveWordField: string; fallbackFieldNames: string[]; readingField: string; parseWords: boolean }
  ) => {
    const cards: AnkiImportCard[] = [];
    const sentenceCards: AnkiImportCard[] = [];
    const sentenceHistory: { word: string; reviews?: AnkiReview[] }[] = [];
    let skipped = 0;
    for (const raw of rawCards) {
      const fieldNames = Object.keys(raw.fields);
      let valueField = options.effectiveWordField;
      let val = raw.fields[valueField] || '';
      if (!val) {
        for (const candidate of options.fallbackFieldNames) {
          val = raw.fields[candidate] || '';
          if (val) { valueField = candidate; break; }
        }
      }
      if (!val) {
        // A copy keeps every card: fall back to the first field that has text.
        const first = fieldNames.find((name) => normalizeAnkiText(raw.fields[name] || ''));
        if (first) { valueField = first; val = raw.fields[first]; }
      }
      const sourceText = normalizeAnkiText(val || '');
      const cleaned = cleanWord(sourceText);
      if (!cleaned) { skipped += 1; continue; }

      const readingFields = [
        options.readingField,
        ...READING_FIELD_PREFERENCES.map((name) => fieldNames.find((field) => normalizeFieldName(field) === normalizeFieldName(name))),
      ].filter((field): field is string => Boolean(field) && field !== valueField);
      let reading = '';
      for (const field of readingFields) {
        const candidate = cleanWord(raw.fields[field] || '');
        if (candidate && /^[\u3040-\u30ffー]+$/.test(candidate)) { reading = candidate; break; }
      }

      const isVocabularyField = /vocabulary|word|kanji|kana/i.test(valueField);
      const isSentenceField = /sentence|example|context|cloze/i.test(valueField);
      const looksLikeSentence = /[。？！]/.test(sourceText) ||
        (sourceText.length > 24 && /[\u3040-\u309F](?:は|が|を|に|で|と|も|の|へ)/.test(sourceText));
      const isSentence = options.parseWords && !isVocabularyField && (isSentenceField || looksLikeSentence);
      if (isSentence && sourceText.length > 3) {
        const words: string[] = [];
        try {
          const paragraphs = await tokenizeText(sourceText);
          paragraphs.flat().forEach((tok) => {
            if (tok && tok.isWord && tok.basicForm) {
              const subClean = cleanWord(tok.basicForm);
              if (subClean && !words.includes(subClean)) words.push(subClean);
            }
          });
        } catch {
          // Keep the source word when the local parser cannot handle a field.
        }
        if (words.length > 0) {
          words.forEach((word) => sentenceCards.push({ ...raw.base, word, reviews: [] }));
          sentenceHistory.push({ word: words[0], reviews: raw.base.reviews });
          continue;
        }
      }
      cards.push({ ...raw.base, word: cleaned, reading: reading || undefined });
    }
    return { cards, sentenceCards, sentenceHistory, skipped };
  };

  /** What an import will leave in Yoru, by state, for the confirmation and result dialogs. */
  const describeAnkiImport = (plan: AnkiImportPlan, ankiCardCount: number, skipped: number) => {
    const c = plan.counts;
    const days = Object.keys(plan.reviewDays).length;
    return lang === 'es'
      ? `Anki: ${ankiCardCount} tarjetas. En Yoru: ${c.total} tarjetas (${c.new} nuevas, ${c.learning} aprendiendo, ${c.relearning} reaprendiendo, ${c.young} jóvenes, ${c.mature} maduras${c.suspended ? `; ${c.suspended} suspendidas` : ''}). Historial: ${plan.reviewCount} repasos en ${days} días.${skipped ? ` ${skipped} tarjetas no tienen texto utilizable y se omiten.` : ''}`
      : `Anki: ${ankiCardCount} cards. In Yoru: ${c.total} cards (${c.new} new, ${c.learning} learning, ${c.relearning} relearning, ${c.young} young, ${c.mature} mature${c.suspended ? `; ${c.suspended} suspended` : ''}). History: ${plan.reviewCount} reviews over ${days} days.${skipped ? ` ${skipped} cards have no usable text and are skipped.` : ''}`;
  };

  /**
   * Saves an import plan: its cards, their words as "learning", and the review history. `replaced`
   * are earlier cards the import takes the place of (findReplacedAnkiCards), removed in the same save.
   */
  const commitAnkiImport = (plan: AnkiImportPlan, replaced: string[] = []) => {
    const updated = { ...db.getWordStatuses() };
    Object.keys(plan.cards).forEach((key) => {
      // 'known' would hide the word from the reader and exclude it from SRS review: imported
      // Anki cards still need both, regardless of how mature they are in Anki.
      updated[srsWordOfKey(key)] = 'learning';
    });
    const entries: Record<string, any> = {};
    replaced.forEach((key) => { entries[key] = null; });
    db.saveSrsCardsBatch({ ...entries, ...plan.cards });
    db.saveWordStatuses(updated);
    db.mergeImportedSrsReviewDays(plan.reviewDays);
    loadVocabStats();
  };

  // --- AnkiConnect Import Execution ---
  const handleImportAnki = async () => {
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Buscando tarjetas en Anki...' : 'Finding cards in Anki...');
    try {
      const deck = ankiSettings.expression.deck || 'sentence mining';
      const wordField = ankiSettings.importWordField || 'Expression';
      const readingField = ankiSettings.importReadingField || '';
      const parseWords = ankiSettings.importParseWords !== false;
      const minInterval = ankiSettings.importMinInterval !== undefined ? Number(ankiSettings.importMinInterval) : 21;
      const deckQuery = `deck:"${deck.replace(/"/g, '\\"')}"`;
      let query = deckQuery;
      if (minInterval > 0) {
        query += ` prop:ivl>=${minInterval}`;
      } else if (minInterval === 0) {
        query += ` -is:new`;
      }

      const auth = ankiSettings.apiKey ? { key: ankiSettings.apiKey } : {};
      const data = await ankiConnectRequest<number[]>(ankiSettings.host, {
        action: 'findCards',
        version: 6,
        params: { query },
        ...auth
      });

      if (!data.result || data.result.length === 0) {
        await showConfirm({
          title: lang === 'es' ? 'Sin tarjetas' : 'No cards found',
          message: lang === 'es'
            ? `No hay tarjetas en "${deck}" que cumplan el criterio seleccionado. Cambia el intervalo o elige otro mazo.`
            : `No cards in "${deck}" match the selected interval. Change the interval or choose another deck.`,
          type: 'warning',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      setProgressMsg(lang === 'es' ? `Cargando información de ${data.result.length} tarjetas...` : `Loading info for ${data.result.length} cards...`);

      const infoData = await ankiConnectRequest<AnkiCardInfo[]>(ankiSettings.host, {
        action: 'cardsInfo',
        version: 6,
        params: { cards: data.result },
        ...auth
      });
      if (!infoData.result?.length) throw new Error(lang === 'es' ? 'Anki no devolvió los datos de las tarjetas.' : 'Anki returned no card details.');

      setProgressMsg(lang === 'es' ? 'Procesando y extrayendo vocabulario...' : 'Processing and extracting vocabulary...');
      const allFieldNames = Array.from(new Set(infoData.result.flatMap(card => Object.keys(card.fields || {}))));
      const effectiveWordField = chooseAnkiWordField(allFieldNames, wordField, ankiSettings.importWordFieldManual === true);
      const fallbackFieldNames = [
        effectiveWordField,
        ...['vocabulary-kanji', 'vocabulary-kana', 'word', 'kanji', 'vocabulary', 'front', 'expression'].map(name =>
          allFieldNames.find(field => field.toLowerCase().replace(/[^a-z0-9]/g, '') === name.replace(/[^a-z0-9]/g, ''))
        ),
        readingField,
        ...['reading', 'vocabulary-kana', 'kana', 'furigana'].map(name =>
          allFieldNames.find(field => field.toLowerCase().replace(/[^a-z0-9]/g, '') === name.replace(/[^a-z0-9]/g, ''))
        )
      ].filter((field, index, list): field is string => Boolean(field) && list.indexOf(field) === index);

      if (effectiveWordField && effectiveWordField !== wordField) {
        saveAnkiSettings({ ...ankiSettings, importWordField: effectiveWordField, importWordFieldManual: false });
      }

      // Review history (revlog) for the heatmap, streak and FSRS memory state. Older AnkiConnect
      // versions lack getReviewsOfCards; the import then goes ahead without history.
      const reviewsByCard: Record<string, any[]> = {};
      try {
        const cardIds = infoData.result.map(card => card.cardId).filter((id): id is number => Number.isFinite(id));
        for (let i = 0; i < cardIds.length; i += 500) {
          const reviews = await ankiConnectRequest<Record<string, any[]>>(ankiSettings.host, {
            action: 'getReviewsOfCards',
            version: 6,
            params: { cards: cardIds.slice(i, i + 500).map(String) },
            ...auth
          });
          Object.assign(reviewsByCard, reviews.result || {});
        }
      } catch (err) {
        console.warn('Could not read the Anki review history:', err);
      }

      const rawCards: RawAnkiImportCard[] = infoData.result.map(card => ({
        fields: Object.fromEntries(Object.keys(card.fields || {}).map(name => [name, getAnkiFieldValue(card.fields, name)])),
        base: {
          cardId: card.cardId,
          noteId: card.note,
          deck: card.deckName || deck,
          type: card.type ?? ((card.interval || 0) > 0 ? 2 : 0),
          queue: card.queue,
          interval: card.interval || 0,
          reps: card.reps || 0,
          lapses: card.lapses || 0,
          factor: card.factor || 2500,
          due: card.due,
          mod: card.mod,
          reviews: (reviewsByCard[String(card.cardId)] || []).map((r: any) => ({
            at: Number(r.id), rating: Number(r.ease) || 0, type: Number(r.type) || 0, ivl: Number(r.ivl) || 0
          })),
        },
      }));
      const collected = await collectAnkiImportCards(rawCards, { effectiveWordField: effectiveWordField || wordField, fallbackFieldNames, readingField, parseWords });

      if (collected.cards.length === 0 && collected.sentenceCards.length === 0) {
        const actualFields = allFieldNames.length > 0 ? allFieldNames.join(', ') : (lang === 'es' ? 'ninguno' : 'none');
        await showConfirm({
          title: lang === 'es' ? 'Extracción fallida' : 'Extraction failed',
          message: lang === 'es'
            ? `Anki encontró ${infoData.result.length} tarjetas, pero no hay texto utilizable en "${effectiveWordField || wordField}". Campos disponibles en el mazo: ${actualFields}. Elige el campo japonés que contiene las palabras.`
            : `Anki found ${infoData.result.length} cards, but field "${effectiveWordField || wordField}" has no usable text. Fields available in this deck: ${actualFields}. Choose the field containing the Japanese words.`,
          type: 'warning',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      const plan = planAnkiImport({ ...collected, crtSeconds: null, existing: db.getSrsData() });
      const importedKeys = new Set(Object.keys(plan.cards));
      const selectedDeckKey = db.cleanVolumeNumber(deck).toLowerCase();
      const sourceBelongsToDeck = (source: string) => {
        const sourceKey = db.cleanVolumeNumber(source).toLowerCase();
        return sourceKey === selectedDeckKey || sourceKey.startsWith(`${selectedDeckKey}::`);
      };
      const previousSrsData = db.getSrsData();
      const previousDeckEntries = Object.entries(previousSrsData).filter(([word, card]: [string, any]) =>
        !word.startsWith('_deck_') && card?.source && sourceBelongsToDeck(String(card.source))
      );
      const staleDeckEntries = previousDeckEntries.filter(([word]) => !importedKeys.has(word));

      const ok = await showConfirm({
        title: lang === 'es' ? '¿Sincronizar palabras?' : 'Sync words?',
        message: lang === 'es'
          ? `${describeAnkiImport(plan, infoData.result.length, collected.skipped)} Yoru ya tiene ${previousDeckEntries.length} tarjetas de este mazo${staleDeckEntries.length ? `, ${staleDeckEntries.length} no aparecen en esta importación` : ''}. ¿Deseas continuar?`
          : `${describeAnkiImport(plan, infoData.result.length, collected.skipped)} Yoru already has ${previousDeckEntries.length} cards from this deck${staleDeckEntries.length ? `, ${staleDeckEntries.length} are absent from this import` : ''}. Continue?`,
        type: 'info',
        confirmText: lang === 'es' ? 'Importar' : 'Import'
      });

      if (ok) {
        let removedStaleCount = 0;
        if (staleDeckEntries.length > 0) {
          const replacePrevious = await showConfirm({
            title: lang === 'es' ? 'Importación anterior detectada' : 'Previous import detected',
            message: lang === 'es'
              ? `Hay ${staleDeckEntries.length} palabras de este mazo que ya no aparecen en el campo de vocabulario seleccionado. Reemplazarlas borrará sus tarjetas y programación SRS de Yoru. Si quieres conservarlas, elige conservar.`
              : `${staleDeckEntries.length} words from this deck are not in the selected vocabulary field. Replacing them deletes those Yoru cards and their SRS schedules. Choose keep to preserve them.`,
            type: 'warning',
            confirmText: lang === 'es' ? 'Reemplazar anteriores' : 'Replace previous',
            cancelText: lang === 'es' ? 'Conservar anteriores' : 'Keep previous'
          });
          if (replacePrevious) {
            db.saveSrsCardsBatch(Object.fromEntries(staleDeckEntries.map(([word]) => [word, null])));
            removedStaleCount = staleDeckEntries.length;
          }
        }

        commitAnkiImport(plan);
        await showConfirm({
          title: lang === 'es' ? 'Completado' : 'Success',
          message: lang === 'es'
            ? `Importación terminada. ${describeAnkiImport(plan, infoData.result.length, collected.skipped)}${removedStaleCount ? ` Se quitaron ${removedStaleCount} tarjetas obsoletas de la importación anterior.` : staleDeckEntries.length ? ` Se conservaron ${staleDeckEntries.length} tarjetas anteriores.` : ''}`
            : `Import finished. ${describeAnkiImport(plan, infoData.result.length, collected.skipped)}${removedStaleCount ? ` Removed ${removedStaleCount} stale cards from the previous import.` : staleDeckEntries.length ? ` Kept ${staleDeckEntries.length} previous cards.` : ''}`,
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
      }
    } catch (err: any) {
      console.error(err);
      await showConfirm({
        title: 'Error',
        message: err.message,
        type: 'warning',
        confirmText: 'OK',
        cancelText: ''
      });
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- Direct .apkg/.colpkg file import (no AnkiConnect needed) ---
  const handleImportApkgFile = async (file: File) => {
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Leyendo el archivo de Anki...' : 'Reading the Anki file...');
    try {
      const sizeMb = file.size ? ` (${Math.max(1, Math.round(file.size / 1048576))} MB)` : '';
      const stepLabels: Record<ApkgStep, string> = lang === 'es'
        ? { reading: `Leyendo el archivo de Anki${sizeMb}...`, decompressing: 'Descomprimiendo la colección...', opening: 'Abriendo la colección...', cards: 'Leyendo las tarjetas...', history: 'Leyendo el historial de repasos...' }
        : { reading: `Reading the Anki file${sizeMb}...`, decompressing: 'Decompressing the collection...', opening: 'Opening the collection...', cards: 'Reading the cards...', history: 'Reading the review history...' };
      const { parseApkgCollection, ApkgStepError } = await import('../utils/apkgImport');
      let parsed: Awaited<ReturnType<typeof parseApkgCollection>>;
      try {
        parsed = await parseApkgCollection(file, (step) => setProgressMsg(stepLabels[step]));
      } catch (err) {
        if (err instanceof Error && err.message === 'apkg-unreadable') {
          throw new Error(lang === 'es'
            ? 'No se pudo leer la colección dentro del archivo. Vuelve a exportar el mazo desde Anki como "Paquete de mazo de Anki (.apkg)" e inténtalo de nuevo.'
            : 'The collection inside the file could not be read. Export the deck again from Anki as an "Anki Deck Package (.apkg)" and try again.');
        }
        if (err instanceof ApkgStepError) {
          throw new Error(lang === 'es'
            ? `La importación se detuvo en el paso "${stepLabels[err.step]}" porque tardó demasiado. Si elegiste el archivo desde Google Drive u otra nube, descárgalo primero al teléfono y elígelo desde Descargas.`
            : `The import stopped at "${stepLabels[err.step]}" because it took too long. If you picked the file from Google Drive or another cloud, download it to the phone first and pick it from Downloads.`);
        }
        throw err;
      }
      const { cards, crtSeconds } = parsed;
      if (cards.length === 0) {
        await showConfirm({
          title: lang === 'es' ? 'Sin tarjetas' : 'No cards found',
          message: lang === 'es' ? 'El archivo no contiene tarjetas.' : 'The file contains no cards.',
          type: 'warning',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      setProgressMsg(lang === 'es' ? 'Procesando y extrayendo vocabulario...' : 'Processing and extracting vocabulary...');
      const wordField = ankiSettings.importWordField || 'Expression';
      const readingField = ankiSettings.importReadingField || '';
      const parseWords = ankiSettings.importParseWords !== false;
      const allFieldNames = Array.from(new Set(cards.flatMap((c) => Object.keys(c.fields))));
      // The word field set for the AnkiConnect deck is for another deck: only keep it if it
      // does not look like a sentence field, as "Expression" (the old default) does.
      const effectiveWordField = chooseAnkiWordField(allFieldNames, wordField, false);
      const fallbackFieldNames = [
        effectiveWordField,
        ...['vocabulary-kanji', 'vocabulary-kana', 'word', 'kanji', 'vocabulary', 'front', 'expression'].map((name) =>
          allFieldNames.find((field) => field.toLowerCase().replace(/[^a-z0-9]/g, '') === name.replace(/[^a-z0-9]/g, ''))
        ),
        readingField,
        ...['reading', 'vocabulary-kana', 'kana', 'furigana'].map((name) =>
          allFieldNames.find((field) => field.toLowerCase().replace(/[^a-z0-9]/g, '') === name.replace(/[^a-z0-9]/g, ''))
        )
      ].filter((field, index, list): field is string => Boolean(field) && list.indexOf(field) === index);

      const rawCards: RawAnkiImportCard[] = cards.map((card) => ({
        fields: card.fields,
        base: {
          cardId: card.cardId,
          noteId: card.noteId,
          deck: card.deckName,
          type: card.type,
          queue: card.queue,
          interval: card.interval,
          reps: card.reps,
          lapses: card.lapses,
          factor: card.factor,
          due: card.due,
          mod: card.mod,
          memory: card.memory,
          lastReviewSeconds: card.lastReviewSeconds,
          reviews: card.reviews,
        },
      }));
      const collected = await collectAnkiImportCards(rawCards, { effectiveWordField, fallbackFieldNames, readingField, parseWords });
      if (collected.cards.length === 0 && collected.sentenceCards.length === 0) {
        const actualFields = allFieldNames.length > 0 ? allFieldNames.join(', ') : (lang === 'es' ? 'ninguno' : 'none');
        await showConfirm({
          title: lang === 'es' ? 'Extracción fallida' : 'Extraction failed',
          message: lang === 'es'
            ? `El archivo tenía ${cards.length} tarjetas, pero no hay texto utilizable en "${effectiveWordField}". Campos disponibles: ${actualFields}.`
            : `The file had ${cards.length} cards, but field "${effectiveWordField}" has no usable text. Fields available: ${actualFields}.`,
          type: 'warning',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      const existing = db.getSrsData();
      const plan = planAnkiImport({ ...collected, crtSeconds, existing });
      // The file is the whole deck: earlier cards of its decks that it does not bring back would
      // stay on top of it and the deck would no longer match Anki, so they are replaced.
      const replaced = findReplacedAnkiCards(plan, [...collected.cards, ...collected.sentenceCards], existing,
        (name) => db.cleanVolumeNumber(name.replace(/\x1f/g, '::')).toLowerCase());
      const replacedNote = replaced.length
        ? (lang === 'es'
          ? ` Se quitarán ${replaced.length} tarjetas de importaciones anteriores de este mazo que no están en el archivo.`
          : ` ${replaced.length} cards from earlier imports of this deck that are not in the file will be removed.`)
        : '';
      const ok = await showConfirm({
        title: lang === 'es' ? '¿Importar mazo?' : 'Import deck?',
        message: `${describeAnkiImport(plan, cards.length, collected.skipped)}${replacedNote} ${lang === 'es' ? '¿Deseas continuar?' : 'Continue?'}`,
        type: 'info',
        confirmText: lang === 'es' ? 'Importar' : 'Import'
      });

      if (ok) {
        commitAnkiImport(plan, replaced);
        const removedNote = replaced.length
          ? (lang === 'es' ? ` Se quitaron ${replaced.length} tarjetas anteriores.` : ` Removed ${replaced.length} earlier cards.`)
          : '';
        await showConfirm({
          title: lang === 'es' ? 'Completado' : 'Success',
          message: `${lang === 'es' ? 'Importación terminada.' : 'Import finished.'} ${describeAnkiImport(plan, cards.length, collected.skipped)}${removedNote}`,
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
      }
    } catch (err: any) {
      console.error(err);
      await showConfirm({
        title: 'Error',
        message: err.message,
        type: 'warning',
        confirmText: 'OK',
        cancelText: ''
      });
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- JPDB Import Execution ---
  const handleImportJpdb = async () => {
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Conectando con JPDB...' : 'Connecting to JPDB...');
    try {
      if (jpdbApiKey) {
        localStorage.setItem('jpdb_api_key', jpdbApiKey);
        setProgressMsg(lang === 'es' ? 'Obteniendo mazos de JPDB...' : 'Fetching decks from JPDB...');
        const decksRes = await fetch('https://jpdb.io/api/v1/list-user-decks', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jpdbApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });
        if (!decksRes.ok) throw new Error(lang === 'es' ? 'Error al autenticar clave API de JPDB.' : 'Invalid JPDB API Key.');
        const decksData = await decksRes.json();
        
        const words = new Set<string>();
        if (decksData.decks && decksData.decks.length > 0) {
          for (let i = 0; i < decksData.decks.length; i++) {
            const d = decksData.decks[i];
            setProgressMsg(lang === 'es' ? `Cargando mazo ${i+1}/${decksData.decks.length}: ${d.name || d.id}...` : `Loading deck ${i+1}/${decksData.decks.length}: ${d.name || d.id}...`);
            const vocabRes = await fetch('https://jpdb.io/api/v1/deck/list-vocabulary', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${jpdbApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ id: d.id, fetch_vocabulary: true })
            });
            if (vocabRes.ok) {
              const vocabData = await vocabRes.json();
              if (vocabData.vocabulary && vocabData.vocabulary.length > 0) {
                vocabData.vocabulary.forEach((item: any) => {
                  if (item.spelling) words.add(item.spelling);
                });
              }
            }
          }
        }

        if (words.size === 0) {
          await showConfirm({
            title: lang === 'es' ? 'Sin palabras' : 'No words found',
            message: lang === 'es' ? 'No se encontraron palabras conocidas en tus mazos de JPDB.' : 'No known words were found in your JPDB decks.',
            type: 'warning',
            confirmText: 'OK',
            cancelText: ''
          });
          setIsLoading(false);
          return;
        }

        const ok = await showConfirm({
          title: lang === 'es' ? 'Importar desde JPDB' : 'Import from JPDB',
          message: lang === 'es' 
            ? `Se encontraron ${words.size} palabras en JPDB. ¿Deseas añadirlas a tu vocabulario?`
            : `Found ${words.size} words in JPDB. Do you want to add them to your vocabulary?`,
          type: 'info',
          confirmText: lang === 'es' ? 'Importar' : 'Import'
        });

        if (ok) {
          const current = db.getWordStatuses();
          const updated = { ...current };
          words.forEach(w => { updated[w] = 'known'; });
          db.saveWordStatuses(updated);
          loadVocabStats();
          await showConfirm({
            title: lang === 'es' ? 'Completado' : 'Success',
            message: lang === 'es' ? `¡Importadas ${words.size} palabras de JPDB!` : `Successfully imported ${words.size} words from JPDB!`,
            type: 'info',
            confirmText: 'OK',
            cancelText: ''
          });
        }
      } else if (jpdbReviewsFile) {
        setProgressMsg(lang === 'es' ? 'Procesando archivo de reseñas...' : 'Processing reviews file...');
        const text = await jpdbReviewsFile.text();
        const data = JSON.parse(text);
        const vocabCards = data.cards_vocabulary_jp_en || [];
        if (vocabCards.length === 0) {
          await showConfirm({
            title: 'Error',
            message: lang === 'es' ? 'No se encontraron registros de vocabulario en el archivo.' : 'No vocabulary reviews found in the file.',
            type: 'warning',
            confirmText: 'OK',
            cancelText: ''
          });
          setIsLoading(false);
          return;
        }
        
        const words: string[] = [];
        vocabCards.forEach((c: any) => {
          if (c.spelling && (c.reviews && c.reviews.length > 0 || !jpdbOverwrite)) {
            words.push(c.spelling);
          }
        });

        if (words.length === 0) {
          await showConfirm({
            title: 'Sin palabras',
            message: lang === 'es' ? 'Ninguna palabra en el archivo cumple los criterios de importación.' : 'No words in the file match the import criteria.',
            type: 'warning',
            confirmText: 'OK',
            cancelText: ''
          });
          setIsLoading(false);
          return;
        }

        const ok = await showConfirm({
          title: lang === 'es' ? 'Importar Reseñas' : 'Import Reviews',
          message: lang === 'es' 
            ? `Se encontraron ${words.length} palabras estudiadas. ¿Deseas importarlas como "Conocido"?`
            : `Found ${words.length} studied words. Do you want to import them as "Known"?`,
          type: 'info',
          confirmText: lang === 'es' ? 'Importar' : 'Import'
        });

        if (ok) {
          const current = db.getWordStatuses();
          const updated = { ...current };
          words.forEach(w => { updated[w] = 'known'; });
          db.saveWordStatuses(updated);
          loadVocabStats();
          await showConfirm({
            title: lang === 'es' ? 'Completado' : 'Success',
            message: lang === 'es' ? `¡Importadas ${words.length} palabras con éxito!` : `Successfully imported ${words.length} words!`,
            type: 'info',
            confirmText: 'OK',
            cancelText: ''
          });
        }
      } else {
        throw new Error(lang === 'es' ? 'Proporciona una clave API de JPDB o selecciona un archivo reviews.json.' : 'Please provide a JPDB API Key or select a reviews.json file.');
      }
    } catch (err: any) {
      console.error(err);
      await showConfirm({
        title: 'Error',
        message: err.message,
        type: 'warning',
        confirmText: 'OK',
        cancelText: ''
      });
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- File Import (.txt / .csv) ---
  const handleImportFile = async () => {
    if (!vocabFile) return;
    if (/\.(apkg|colpkg)$/i.test(vocabFile.name)) {
      await handleImportApkgFile(vocabFile);
      return;
    }
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Leyendo archivo...' : 'Reading file...');
    try {
      const text = await vocabFile.text();
      const lines = text.split(/\r?\n/);
      const rawWords: string[] = [];
      lines.forEach(l => {
        const cleanL = l.trim();
        if (cleanL && !cleanL.startsWith('#')) {
          const parts = cleanL.split(/[\t,;]/);
          const firstPart = parts[0]?.trim();
          if (firstPart) rawWords.push(firstPart);
        }
      });

      if (rawWords.length === 0) {
        await showConfirm({
          title: 'Error',
          message: lang === 'es' ? 'El archivo está vacío o no contiene vocabulario legible.' : 'The file is empty or does not contain readable vocabulary.',
          type: 'warning',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      setProgressMsg(lang === 'es' ? 'Analizando palabras...' : 'Analyzing words...');
      const words: string[] = [];
      for (const w of rawWords) {
        const cleaned = cleanWord(w);
        if (cleaned) {
          const isSentence = fileParseWords && (
            cleaned.length > 5 || 
            cleaned.includes('。') || 
            cleaned.includes('、') || 
            cleaned.includes('？') || 
            cleaned.includes('！')
          );
          if (isSentence && cleaned.length > 3) {
            try {
              const paragraphs = await tokenizeText(cleaned);
              paragraphs.flat().forEach(tok => {
                if (tok && tok.isWord && tok.basicForm) {
                  const subClean = cleanWord(tok.basicForm);
                  if (subClean) words.push(subClean);
                }
              });
            } catch {
              words.push(cleaned);
            }
          } else {
            words.push(cleaned);
          }
        }
      }

      const ok = await showConfirm({
        title: lang === 'es' ? 'Importar desde archivo' : 'Import from file',
        message: lang === 'es' 
          ? `Se encontraron ${words.length} palabras. ¿Deseas añadirlas como "Conocido"?`
          : `Found ${words.length} words. Do you want to import them as "Known"?`,
        type: 'info',
        confirmText: lang === 'es' ? 'Importar' : 'Import'
      });

      if (ok) {
        const current = db.getWordStatuses();
        const updated = { ...current };
        words.forEach(w => { updated[w] = 'known'; });
        db.saveWordStatuses(updated);
        loadVocabStats();
        await showConfirm({
          title: lang === 'es' ? 'Completado' : 'Success',
          message: lang === 'es' ? `¡Importadas ${words.length} palabras con éxito!` : `Successfully imported ${words.length} words!`,
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
      }
    } catch (err: any) {
      console.error(err);
      await showConfirm({
        title: 'Error',
        message: err.message,
        type: 'warning',
        confirmText: 'OK',
        cancelText: ''
      });
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- Frequency Range Import ---
  const handleImportFrequency = async () => {
    if (!selectedFreqDict) return;
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Consultando diccionario de frecuencias...' : 'Querying frequency dictionary...');
    try {
      const words = await getTopWordsFromFrequencyDict(selectedFreqDict, Number(freqMaxRank));
      if (words.length === 0) {
        await showConfirm({
          title: 'Sin palabras',
          message: lang === 'es' ? 'No se encontraron palabras en este rango en el diccionario seleccionado.' : 'No words found in this range in the selected dictionary.',
          type: 'warning',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      const ok = await showConfirm({
        title: lang === 'es' ? 'Importar Frecuencia' : 'Import Frequency',
        message: lang === 'es' 
          ? `Se encontraron ${words.length} palabras en el rango 1 a ${freqMaxRank} del diccionario "${selectedFreqDict}". ¿Deseas marcarlas como "Conocido"?`
          : `Found ${words.length} words in range 1 to ${freqMaxRank} of "${selectedFreqDict}". Do you want to mark them as "Known"?`,
        type: 'info',
        confirmText: lang === 'es' ? 'Importar' : 'Import'
      });

      if (ok) {
        const current = db.getWordStatuses();
        const updated = { ...current };
        words.forEach(w => { updated[w] = 'known'; });
        db.saveWordStatuses(updated);
        loadVocabStats();
        await showConfirm({
          title: lang === 'es' ? 'Completado' : 'Success',
          message: lang === 'es' ? `¡Importadas ${words.length} palabras con éxito!` : `Successfully imported ${words.length} words!`,
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
      }
    } catch (err: any) {
      console.error(err);
      await showConfirm({
        title: 'Error',
        message: err.message,
        type: 'warning',
        confirmText: 'OK',
        cancelText: ''
      });
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- Vocabulary Backup JSON ---
  const handleImportBackup = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Restaurando copia de seguridad...' : 'Restoring backup...');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON backup file.');
      
      const ok = await showConfirm({
        title: lang === 'es' ? 'Importar copia de seguridad' : 'Import backup',
        message: lang === 'es' 
          ? `Se importarán los estados de palabras de la copia de seguridad. Esto sobrescribirá tus estados de palabras actuales. ¿Deseas continuar?`
          : `This will overwrite your current word statuses with the backup version. Do you want to continue?`,
        type: 'warning',
        confirmText: lang === 'es' ? 'Importar' : 'Import'
      });

      if (ok) {
        db.saveWordStatuses(parsed);
        loadVocabStats();
        await showConfirm({
          title: lang === 'es' ? 'Completado' : 'Success',
          message: lang === 'es' ? '¡Vocabulario restaurado con éxito!' : 'Vocabulary restored successfully!',
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
      }
    } catch (err: any) {
      console.error(err);
      await showConfirm({
        title: 'Error',
        message: err.message,
        type: 'warning',
        confirmText: 'OK',
        cancelText: ''
      });
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- Export JSON / TXT ---
  const handleExportJSON = () => {
    const statuses = db.getWordStatuses();
    const blob = new Blob([JSON.stringify(statuses, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yoru_vocabulary_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTXT = (onlyKnown: boolean) => {
    const statuses = db.getWordStatuses();
    const words = Object.keys(statuses).filter(w => !onlyKnown || statuses[w] === 'known');
    const blob = new Blob([words.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yoru_vocabulary_${onlyKnown ? 'known_' : ''}${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Mass Actions: Composition ---
  const handleExpandComponents = async () => {
    setIsLoading(true);
    setProgressMsg(lang === 'es' ? 'Analizando palabras y extrayendo partes...' : 'Analyzing words and extracting parts...');
    try {
      const current = db.getWordStatuses();
      const known = Object.keys(current).filter(w => current[w] === 'known');
      const added = new Set<string>();
      
      for (const word of known) {
        if (word.length > 1) {
          try {
            const paragraphs = await tokenizeText(word);
            paragraphs.flat().forEach(tok => {
              if (tok && tok.isWord && tok.basicForm && tok.basicForm !== word) {
                const cleaned = cleanWord(tok.basicForm);
                if (cleaned && current[cleaned] !== 'known') {
                  added.add(cleaned);
                }
              }
            });
          } catch {}
        }
      }

      if (added.size === 0) {
        await showConfirm({
          title: lang === 'es' ? 'Sin cambios' : 'No components found',
          message: lang === 'es' ? 'No se encontraron componentes nuevos para agregar.' : 'No new components were found to add.',
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
        setIsLoading(false);
        return;
      }

      const ok = await showConfirm({
        title: lang === 'es' ? 'Expandir componentes' : 'Expand components',
        message: lang === 'es' 
          ? `Se encontraron ${added.size} palabras componentes (partes de palabras compuestas que ya conoces). ¿Deseas marcarlas como "Conocido" en tu base de datos?`
          : `Found ${added.size} component words (parts of compound words you already know). Do you want to mark them as "Known" in your database?`,
        type: 'info',
        confirmText: lang === 'es' ? 'Agregar' : 'Add'
      });

      if (ok) {
        const updated = { ...current };
        added.forEach(w => { updated[w] = 'known'; });
        db.saveWordStatuses(updated);
        loadVocabStats();
        await showConfirm({
          title: lang === 'es' ? 'Completado' : 'Success',
          message: lang === 'es' ? `¡Agregadas ${added.size} palabras componentes con éxito!` : `Successfully added ${added.size} component words!`,
          type: 'info',
          confirmText: 'OK',
          cancelText: ''
        });
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  // --- Mass Actions: Danger Zone ---
  const handleClearVocabulary = async () => {
    const ok = await showConfirm({
      title: lang === 'es' ? '¡ADVERTENCIA IRREVERSIBLE!' : 'IRREVERSIBLE WARNING!',
      message: lang === 'es' 
        ? 'Esto eliminará de forma permanente TODAS tus palabras conocidas, destacadas y en aprendizaje de la aplicación. Esta acción no se puede deshacer. ¿Seguro que deseas continuar?'
        : 'This will permanently delete ALL your known, starred, and learning words from the application. This action cannot be undone. Are you sure you want to continue?',
      type: 'danger',
      confirmText: lang === 'es' ? 'Eliminar todo' : 'Delete all'
    });

    if (ok) {
      db.saveWordStatuses({});
      loadVocabStats();
      await showConfirm({
        title: lang === 'es' ? 'Completado' : 'Deleted',
        message: lang === 'es' ? 'El vocabulario ha sido vaciado.' : 'All vocabulary has been cleared.',
        type: 'info',
        confirmText: 'OK',
        cancelText: ''
      });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1400 }}>
        <div className="yomitan-anki-modal" onClick={e => e.stopPropagation()} style={{ width: '640px', maxWidth: '95vw', height: '80vh', display: 'flex', flexDirection: 'column' }}>
          
          {/* Header */}
          <div className="yomitan-anki-header">
            <div className="yomitan-anki-header-left">
              <Database size={16} style={{ color: 'var(--primary)', marginRight: '2px' }} />
              <span className="yomitan-anki-title">{lang === 'es' ? 'Gestión de Vocabulario' : 'Vocabulary Management'}</span>
            </div>
            <button className="yomitan-close-btn" onClick={onClose}><X size={16} /></button>
          </div>

          {/* Tab Navigation */}
          <div style={{ display: 'flex', background: 'var(--bg-card-hover)', borderBottom: '1px solid var(--border-light)' }}>
            {[
              { id: 'summary', label: lang === 'es' ? 'Resumen' : 'Summary' },
              { id: 'import', label: lang === 'es' ? 'Importar' : 'Import' },
              { id: 'export', label: lang === 'es' ? 'Exportar' : 'Export' },
              { id: 'actions', label: lang === 'es' ? 'Acciones Masivas' : 'Mass Actions' }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  flex: 1,
                  background: activeTab === t.id ? 'rgba(242, 200, 102, 0.05)' : 'none',
                  border: 'none',
                  borderBottom: activeTab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
                  color: activeTab === t.id ? 'var(--primary)' : 'var(--text-muted)',
                  padding: '12px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Modal Body */}
          <div className="yomitan-anki-body" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            
            {/* 1. SUMMARY TAB */}
            {activeTab === 'summary' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {lang === 'es' ? 'Palabras Totales Registradas' : 'Total Tracked Words'}
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--text-main)', margin: '10px 0' }}>
                    {stats.total.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {lang === 'es' ? 'Estadísticas del vocabulario acumulado en la base de datos local' : 'Aggregated stats from your local database'}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {[
                    { label: lang === 'es' ? 'Conocidas' : 'Known', count: stats.known, color: 'var(--status-known)' },
                    { label: lang === 'es' ? 'Aprendiendo' : 'Learning', count: stats.learning, color: 'var(--status-learning)' },
                    { label: lang === 'es' ? 'Destacadas' : 'Starred', count: stats.starred, color: '#ab47bc' },
                    { label: lang === 'es' ? 'Ignoradas' : 'Ignored', count: stats.ignored, color: 'var(--text-muted)' }
                  ].map(c => (
                    <div key={c.label} style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>{c.label}</span>
                      <span style={{ fontSize: '1.25rem', fontWeight: 800, color: c.color }}>{c.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. IMPORT TAB */}
            {activeTab === 'import' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* Method list: one row per way to import; picking one shows only its panel. */}
                {!importMethod ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { id: 'anki-file', icon: Layers, highlight: true,
                        title: lang === 'es' ? 'Mazo de Anki (.apkg)' : 'Anki deck (.apkg)',
                        desc: lang === 'es' ? 'Copia tus tarjetas con su progreso, fechas e historial.' : 'Copies your cards with their progress, due dates and history.' },
                      ...(ankiConnectAvailable ? [{ id: 'anki-connect', icon: Link2, highlight: false,
                        title: lang === 'es' ? 'Anki abierto (AnkiConnect)' : 'Running Anki (AnkiConnect)',
                        desc: lang === 'es' ? 'Lee un mazo directamente de Anki en esta computadora.' : 'Reads a deck straight from Anki on this computer.' }] : []),
                      { id: 'word-list', icon: FileText, highlight: false,
                        title: lang === 'es' ? 'Lista de palabras' : 'Word list',
                        desc: lang === 'es' ? 'Archivo .txt o .csv, una palabra por línea.' : 'A .txt or .csv file, one word per line.' },
                      { id: 'jpdb', icon: Database, highlight: false,
                        title: 'JPDB',
                        desc: lang === 'es' ? 'Tu vocabulario de jpdb.io.' : 'Your jpdb.io vocabulary.' },
                      { id: 'frequency', icon: ListOrdered, highlight: false,
                        title: lang === 'es' ? 'Lista de frecuencia' : 'Frequency list',
                        desc: lang === 'es' ? 'Marca como conocidas las palabras más comunes.' : 'Marks the most common words as known.' },
                      { id: 'backup', icon: Archive, highlight: false,
                        title: lang === 'es' ? 'Copia de Yoru (JSON)' : 'Yoru backup (JSON)',
                        desc: lang === 'es' ? 'Restaura una copia de tu vocabulario.' : 'Restores a copy of your vocabulary.' },
                    ].map(m => {
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setImportMethod(m.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                            padding: '14px', borderRadius: '12px', cursor: 'pointer',
                            background: m.highlight ? 'rgba(242, 200, 102, 0.08)' : 'var(--bg-card-hover)',
                            border: m.highlight ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                            color: 'var(--text-main)'
                          }}
                        >
                          <Icon size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '0.92rem', fontWeight: 700 }}>{m.title}</span>
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>{m.desc}</span>
                          </span>
                          <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setImportMethod(''); setVocabFile(null); }}
                    style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', padding: '4px 0', color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    <ChevronLeft size={16} />
                    {lang === 'es' ? 'Otras formas de importar' : 'Other ways to import'}
                  </button>
                )}

                {/* Sub-panels */}
                
                {/* 2a. AnkiConnect Panel */}
                {importMethod === 'anki-connect' && ankiConnectAvailable && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', lineHeight: '1.4', marginBottom: '8px' }}>
                      {lang === 'es' 
                        ? 'Importa palabras directamente desde tu colección local de AnkiConnect.' 
                        : 'Import words directly from your local AnkiConnect collection.'}
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'Dirección de AnkiConnect' : 'AnkiConnect address'}</span>
                      <input
                        type="text"
                        className="yomitan-anki-input"
                        value={ankiSettings.host || ''}
                        onChange={e => {
                          saveAnkiSettings({ ...ankiSettings, host: e.target.value });
                          setConnectionStatus('disconnected');
                          setConnectionError('');
                          setAvailableDecks([]);
                          setAvailableModels([]);
                        }}
                        placeholder="http://127.0.0.1:8765"
                        spellCheck={false}
                      />
                    </div>

                    <div role="status" aria-live="polite" style={{
                      display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px',
                      borderRadius: '8px', border: `1px solid ${connectionStatus === 'connected' ? 'rgba(34,197,94,.35)' : connectionStatus === 'error' ? 'rgba(248,113,113,.35)' : 'rgba(255,255,255,.1)'}`,
                      background: connectionStatus === 'connected' ? 'rgba(34,197,94,.08)' : connectionStatus === 'error' ? 'rgba(248,113,113,.08)' : 'rgba(255,255,255,.025)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <span style={{ fontSize: '0.78rem', color: connectionStatus === 'connected' ? '#4ade80' : connectionStatus === 'error' ? '#fca5a5' : 'var(--text-muted)' }}>
                          {connectionStatus === 'connected'
                            ? (lang === 'es' ? 'Conectado a Anki' : 'Connected to Anki')
                            : connectionStatus === 'testing'
                              ? (lang === 'es' ? 'Conectando con Anki…' : 'Connecting to Anki…')
                              : connectionStatus === 'error'
                                ? (lang === 'es' ? 'No se pudo conectar con Anki' : 'Could not connect to Anki')
                                : (lang === 'es' ? 'Conexión sin comprobar' : 'Connection not checked')}
                        </span>
                        <button type="button" onClick={testAnkiConnection} disabled={connectionStatus === 'testing'} style={{
                          border: '1px solid rgba(255,255,255,.15)', borderRadius: '6px', background: 'rgba(255,255,255,.06)',
                          color: '#fff', padding: '5px 9px', cursor: connectionStatus === 'testing' ? 'wait' : 'pointer',
                          opacity: connectionStatus === 'testing' ? 0.65 : 1, fontSize: '0.73rem', fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: '5px'
                        }}>
                          <RefreshCw size={12} className={connectionStatus === 'testing' ? 'spin' : ''} />
                          {lang === 'es' ? 'Probar conexión' : 'Test connection'}
                        </button>
                      </div>
                      {connectionError && <span style={{ fontSize: '0.72rem', lineHeight: 1.4, color: '#fca5a5', overflowWrap: 'anywhere' }}>{connectionError}</span>}
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'API Key de AnkiConnect (opcional)' : 'AnkiConnect API Key (optional)'}</span>
                      <input
                        type="password"
                        className="yomitan-anki-input"
                        value={ankiSettings.apiKey || ''}
                        onChange={e => {
                          saveAnkiSettings({ ...ankiSettings, apiKey: e.target.value });
                          setConnectionStatus('disconnected');
                          setConnectionError('');
                          setAvailableDecks([]);
                          setAvailableModels([]);
                        }}
                        placeholder={lang === 'es' ? 'Vacío si no has configurado apiKey' : 'Leave blank unless apiKey is set in AnkiConnect'}
                      />
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'Mazo de Anki' : 'Anki Deck'}</span>
                      <select
                        className="yomitan-anki-input"
                        value={ankiSettings.expression?.deck || ''}
                        onChange={e => saveAnkiSettings({
                          ...ankiSettings,
                          expression: { ...ankiSettings.expression, deck: e.target.value },
                          importWordField: '',
                          importWordFieldManual: false,
                          importReadingField: ''
                        })}
                      >
                        {availableDecks.length > 0 ? (
                          availableDecks.map(d => <option key={d} value={d} style={{ background: '#1c1c20' }}>{d}</option>)
                        ) : (
                          <option value={ankiSettings.expression?.deck || 'sentence mining'} style={{ background: '#1c1c20' }}>
                            {ankiSettings.expression?.deck || 'sentence mining'}
                          </option>
                        )}
                      </select>
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'Tipo de nota para minado' : 'Note Type for Mining'}</span>
                      <select
                        className="yomitan-anki-input"
                        value={ankiSettings.expression?.noteType || ''}
                        onChange={e => saveAnkiSettings({ ...ankiSettings, expression: { ...ankiSettings.expression, noteType: e.target.value } })}
                      >
                        {availableModels.length > 0 ? (
                          availableModels.map(m => <option key={m} value={m} style={{ background: '#1c1c20' }}>{m}</option>)
                        ) : (
                          <option value={ankiSettings.expression?.noteType || 'Lapis'} style={{ background: '#1c1c20' }}>
                            {ankiSettings.expression?.noteType || 'Lapis'}
                          </option>
                        )}
                      </select>
                    </div>

                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '-6px' }}>
                      {lang === 'es'
                        ? `Los campos se detectan desde las tarjetas reales del mazo${importSourceModels.length ? ` (${importSourceModels.join(', ')})` : ''}.`
                        : `Fields are detected from actual cards in this deck${importSourceModels.length ? ` (${importSourceModels.join(', ')})` : ''}.`}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="yomitan-anki-field-group">
                        <span className="yomitan-anki-field-title">{lang === 'es' ? 'Campo de la palabra (mazo)' : 'Word Field (deck)'}</span>
                        <select
                          className="yomitan-anki-input"
                          value={ankiSettings.importWordField || ''}
                          onChange={e => saveAnkiSettings({ ...ankiSettings, importWordField: e.target.value, importWordFieldManual: true })}
                        >
                          {expressionFields.length > 0 ? (
                            expressionFields.map(f => <option key={f} value={f} style={{ background: '#1c1c20' }}>{f}</option>)
                          ) : (
                            <option value={ankiSettings.importWordField || 'Expression'} style={{ background: '#1c1c20' }}>{ankiSettings.importWordField || 'Expression'}</option>
                          )}
                        </select>
                      </div>

                      <div className="yomitan-anki-field-group">
                        <span className="yomitan-anki-field-title">{lang === 'es' ? 'Campo de lectura (opcional)' : 'Reading Field (optional)'}</span>
                        <select
                          className="yomitan-anki-input"
                          value={ankiSettings.importReadingField || ''}
                          onChange={e => saveAnkiSettings({ ...ankiSettings, importReadingField: e.target.value })}
                        >
                          <option value="" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Ninguno' : 'None'}</option>
                          {expressionFields.map(f => <option key={f} value={f} style={{ background: '#1c1c20' }}>{f}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'Criterio de importación' : 'Import Criteria'}</span>
                      <select
                        className="yomitan-anki-input"
                        value={ankiSettings.importMinInterval !== undefined ? ankiSettings.importMinInterval : 21}
                        onChange={e => saveAnkiSettings({ ...ankiSettings, importMinInterval: Number(e.target.value) })}
                      >
                        <option value="-1" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Todas las tarjetas (incluyendo nuevas)' : 'All cards (including new)'}</option>
                        <option value="0" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Solo estudiadas (excluyendo nuevas)' : 'Only studied (excluding new)'}</option>
                        <option value="7" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'En repaso (intervalo ≥ 7 días)' : 'Learning/Review (interval ≥ 7 days)'}</option>
                        <option value="21" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Maduras (intervalo ≥ 21 días - recomendado)' : 'Mature (interval ≥ 21 days - recommended)'}</option>
                        <option value="30" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Intervalo ≥ 30 días' : 'Interval ≥ 30 days'}</option>
                        <option value="60" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Intervalo ≥ 60 días' : 'Interval ≥ 60 days'}</option>
                        <option value="90" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Intervalo ≥ 90 días' : 'Interval ≥ 90 days'}</option>
                      </select>
                    </div>

                    <div className="yomitan-anki-row" style={{ padding: '4px 0' }}>
                      <div className="yomitan-anki-row-left" style={{ paddingRight: '12px' }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#fff' }}>{lang === 'es' ? 'Analizar y lematizar oraciones' : 'Parse and lemmatize sentences'}</div>
                      </div>
                      <label className="migaku-switch" style={{ flexShrink: 0 }}>
                        <input
                          type="checkbox"
                          checked={ankiSettings.importParseWords !== false}
                          onChange={e => saveAnkiSettings({ ...ankiSettings, importParseWords: e.target.checked })}
                        />
                        <span className="migaku-switch-slider" />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsCardsModalOpen(true)}
                      className="reset-filter-btn"
                      style={{
                        background: 'rgba(242, 200, 102, 0.03)',
                        borderColor: 'rgba(242, 200, 102, 0.25)',
                        color: 'var(--primary)',
                        marginTop: '4px',
                        justifyContent: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%'
                      }}
                    >
                      <span>🃏 {lang === 'es' ? 'Configurar campos de tarjeta de Anki (Minado)...' : 'Configure Anki card fields (Mining)...'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleImportAnki}
                      disabled={connectionStatus !== 'connected'}
                      className="reset-filter-btn"
                      style={{
                        background: connectionStatus === 'connected' ? 'rgba(242, 200, 102, 0.08)' : 'rgba(255,255,255,0.02)',
                        borderColor: connectionStatus === 'connected' ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                        color: connectionStatus === 'connected' ? 'var(--primary)' : 'var(--text-muted)',
                        marginTop: '12px',
                        justifyContent: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <RefreshCw size={14} className={connectionStatus === 'testing' ? 'spin' : ''} />
                      <span>{lang === 'es' ? 'Importar de Anki' : 'Import from Anki'}</span>
                    </button>
                  </div>
                )}

                {/* 2b. JPDB Panel */}
                {importMethod === 'jpdb' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <h4 style={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{lang === 'es' ? 'Importación por API' : 'API Import'}</h4>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', marginBottom: '8px' }}>
                        {lang === 'es' 
                          ? 'Introduce tu clave API de JPDB (la encuentras en la parte inferior de jpdb.io/settings) para importar automáticamente el vocabulario de tus mazos.' 
                          : 'Enter your JPDB API key (found at the bottom of jpdb.io/settings) to automatically fetch and import your deck vocabulary.'}
                      </p>
                      <input
                        type="password"
                        className="yomitan-anki-input"
                        value={jpdbApiKey}
                        onChange={e => setJpdbApiKey(e.target.value)}
                        placeholder="JPDB API Key"
                      />
                    </div>

                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                    <div>
                      <h4 style={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{lang === 'es' ? 'Importación por Archivo reviews.json' : 'Reviews.json File Import'}</h4>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', marginBottom: '8px' }}>
                        {lang === 'es' 
                          ? 'Alternativamente, puedes exportar tu historial de repasos en formato JSON desde JPDB y cargarlo aquí.' 
                          : 'Alternatively, you can export your review history in JSON format from JPDB settings and upload the reviews.json file here.'}
                      </p>
                      
                      <label className="reset-filter-btn" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}>
                        <Upload size={14} /> 
                        <span>{jpdbReviewsFile ? jpdbReviewsFile.name : (lang === 'es' ? 'Seleccionar archivo reviews.json' : 'Select reviews.json')}</span>
                        <input
                          type="file"
                          accept=".json"
                          style={{ display: 'none' }}
                          onChange={e => setJpdbReviewsFile(e.target.files?.[0] || null)}
                        />
                      </label>

                      <div className="yomitan-anki-row" style={{ padding: '8px 0', marginTop: '6px' }}>
                        <div className="yomitan-anki-row-left" style={{ paddingRight: '12px' }}>
                          <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)' }}>{lang === 'es' ? 'Omitir tarjetas no estudiadas' : 'Skip unstudied cards'}</span>
                        </div>
                        <label className="migaku-switch" style={{ flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={jpdbOverwrite}
                            onChange={e => setJpdbOverwrite(e.target.checked)}
                          />
                          <span className="migaku-switch-slider" />
                        </label>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleImportJpdb}
                      disabled={!jpdbApiKey && !jpdbReviewsFile}
                      className="reset-filter-btn"
                      style={{
                        background: (jpdbApiKey || jpdbReviewsFile) ? 'rgba(242, 200, 102, 0.08)' : 'rgba(255,255,255,0.02)',
                        borderColor: (jpdbApiKey || jpdbReviewsFile) ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                        color: (jpdbApiKey || jpdbReviewsFile) ? 'var(--primary)' : 'var(--text-muted)',
                        marginTop: '12px',
                        justifyContent: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <Download size={14} />
                      <span>{lang === 'es' ? 'Importar de JPDB' : 'Import from JPDB'}</span>
                    </button>
                  </div>
                )}

                {/* 2c. Anki deck (.apkg) Panel */}
                {importMethod === 'anki-file' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {lang === 'es' ? 'Importar un mazo de Anki' : 'Import an Anki deck'}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      <li>{lang === 'es' ? <>En Anki: <b>Archivo › Exportar</b>, formato <b>Paquete de mazo de Anki (.apkg)</b>.</> : <>In Anki: <b>File › Export</b>, format <b>Anki Deck Package (.apkg)</b>.</>}</li>
                      <li>{lang === 'es' ? <>Marca <b>Incluir información de programación</b> para conservar tu progreso.</> : <>Tick <b>Include scheduling information</b> to keep your progress.</>}</li>
                      <li>{isPhoneUI()
                        ? (lang === 'es' ? 'Pasa el archivo a este teléfono y elígelo abajo.' : 'Copy the file to this phone and choose it below.')
                        : (lang === 'es' ? 'Elige el archivo abajo.' : 'Choose the file below.')}</li>
                    </ol>

                    <label
                      className="reset-filter-btn"
                      style={{
                        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isLoading ? 'default' : 'pointer',
                        padding: '14px', fontSize: '0.92rem', fontWeight: 700,
                        background: 'var(--primary)', borderColor: 'var(--primary)', color: '#000', opacity: isLoading ? 0.6 : 1
                      }}
                    >
                      <Upload size={16} />
                      <span>{lang === 'es' ? 'Elegir mazo (.apkg)' : 'Choose deck (.apkg)'}</span>
                      <input
                        type="file"
                        // Android's picker turns accept into MIME types; .apkg has none, so any
                        // accept list would grey the deck out. The name is checked after picking.
                        accept={isPhoneUI() ? undefined : '.apkg,.colpkg'}
                        disabled={isLoading}
                        style={{ display: 'none' }}
                        onChange={async e => {
                          const file = e.target.files?.[0] || null;
                          e.target.value = '';
                          if (!file) return;
                          if (!/\.(apkg|colpkg)$/i.test(file.name)) {
                            await showConfirm({
                              title: lang === 'es' ? 'No es un mazo de Anki' : 'Not an Anki deck',
                              message: lang === 'es'
                                ? `"${file.name}" no es un archivo .apkg. Expórtalo desde Anki como "Paquete de mazo de Anki".`
                                : `"${file.name}" is not an .apkg file. Export it from Anki as an "Anki Deck Package".`,
                              type: 'warning',
                              confirmText: 'OK',
                              cancelText: ''
                            });
                            return;
                          }
                          await handleImportApkgFile(file);
                        }}
                      />
                    </label>

                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      {lang === 'es'
                        ? 'Antes de guardar verás cuántas tarjetas quedan en cada estado. Si ya importaste este mazo, sus tarjetas se actualizan con el estado de Anki.'
                        : 'Before saving you will see how many cards end up in each state. If you imported this deck before, its cards are updated to their state in Anki.'}
                    </div>
                  </div>
                )}

                {/* 2c'. Word list Panel (.txt/.csv) */}
                {importMethod === 'word-list' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      {lang === 'es'
                        ? 'Texto plano (.txt) o separado por comas (.csv): se lee la primera columna de cada línea como una palabra.'
                        : 'Plain text (.txt) or comma-separated (.csv): the first column of each line is read as a word.'}
                    </div>

                    <label className="reset-filter-btn" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}>
                      <Upload size={14} />
                      <span>{vocabFile ? vocabFile.name : (lang === 'es' ? 'Elegir archivo .txt o .csv' : 'Choose a .txt or .csv file')}</span>
                      <input
                        type="file"
                        // Android's picker turns accept into MIME types and greys out the rest.
                        accept={isPhoneUI() ? undefined : '.txt,.csv'}
                        style={{ display: 'none' }}
                        onChange={e => setVocabFile(e.target.files?.[0] || null)}
                      />
                    </label>

                    {(
                      <div className="yomitan-anki-row" style={{ padding: '4px 0' }}>
                        <div className="yomitan-anki-row-left" style={{ paddingRight: '12px' }}>
                          <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#fff' }}>{lang === 'es' ? 'Analizar y lematizar líneas' : 'Parse and lemmatize lines'}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {lang === 'es' ? 'Activa si las líneas contienen oraciones o conjugaciones en lugar de vocablos básicos.' : 'Enable if lines contain sentences or conjugated verbs instead of simple words.'}
                          </div>
                        </div>
                        <label className="migaku-switch" style={{ flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={fileParseWords}
                            onChange={e => setFileParseWords(e.target.checked)}
                          />
                          <span className="migaku-switch-slider" />
                        </label>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleImportFile}
                      disabled={!vocabFile}
                      className="reset-filter-btn"
                      style={{
                        background: vocabFile ? 'rgba(242, 200, 102, 0.08)' : 'rgba(255,255,255,0.02)',
                        borderColor: vocabFile ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                        color: vocabFile ? 'var(--primary)' : 'var(--text-muted)',
                        marginTop: '12px',
                        justifyContent: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <Download size={14} />
                      <span>{lang === 'es' ? 'Importar archivo' : 'Import file'}</span>
                    </button>
                  </div>
                )}

                {/* 2d. Rango de Frecuencia Panel */}
                {importMethod === 'frequency' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      {lang === 'es'
                        ? 'Marca de forma masiva las palabras más comunes como "Conocido" a partir de un diccionario de frecuencias instalado en el lector (ej. las primeras 2000 palabras).'
                        : 'Bulk mark the most frequent words as "Known" using one of your installed frequency lists (e.g. top 2000 words).'}
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'Seleccionar lista de frecuencias' : 'Select Frequency List'}</span>
                      <select
                        className="yomitan-anki-input"
                        value={selectedFreqDict}
                        onChange={e => setSelectedFreqDict(e.target.value)}
                      >
                        {availableFreqDicts.length > 0 ? (
                          availableFreqDicts.map(d => <option key={d.title} value={d.title} style={{ background: '#1c1c20' }}>{d.title}</option>)
                        ) : (
                          <option value="" style={{ background: '#1c1c20' }}>{lang === 'es' ? 'Sin listas instaladas' : 'No lists installed'}</option>
                        )}
                      </select>
                    </div>

                    <div className="yomitan-anki-field-group">
                      <span className="yomitan-anki-field-title">{lang === 'es' ? 'Cantidad de palabras (Límite de rango)' : 'Number of words (Max Rank)'}</span>
                      <input
                        type="number"
                        min="1"
                        max="100000"
                        className="yomitan-anki-input"
                        value={freqMaxRank}
                        onChange={e => setFreqMaxRank(Number(e.target.value))}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleImportFrequency}
                      disabled={!selectedFreqDict || freqMaxRank <= 0}
                      className="reset-filter-btn"
                      style={{
                        background: (selectedFreqDict && freqMaxRank > 0) ? 'rgba(242, 200, 102, 0.08)' : 'rgba(255,255,255,0.02)',
                        borderColor: (selectedFreqDict && freqMaxRank > 0) ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                        color: (selectedFreqDict && freqMaxRank > 0) ? 'var(--primary)' : 'var(--text-muted)',
                        marginTop: '12px',
                        justifyContent: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <Download size={14} />
                      <span>{lang === 'es' ? 'Importar rango' : 'Import range'}</span>
                    </button>
                  </div>
                )}

                {/* 2e. Backup JSON Panel */}
                {importMethod === 'backup' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      {lang === 'es'
                        ? 'Carga una copia de seguridad del vocabulario de Yoru Reader en formato JSON. Advertencia: esto sobrescribirá tu vocabulario actual.'
                        : 'Upload a Yoru Reader vocabulary backup file in JSON format. Warning: this will overwrite your current vocabulary.'}
                    </div>

                    <label className="reset-filter-btn" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}>
                      <Upload size={14} />
                      <span>{lang === 'es' ? 'Cargar archivo JSON de respaldo' : 'Upload JSON Backup File'}</span>
                      <input
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleImportBackup}
                      />
                    </label>
                  </div>
                )}

              </div>
            )}

            {/* 3. EXPORT TAB */}
            {activeTab === 'export' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  {lang === 'es'
                    ? 'Exporta la lista de palabras guardadas en tu perfil para usarlas en otras herramientas o como respaldo.'
                    : 'Export the list of saved words in your profile to use them in other tools or as a backup.'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="reset-filter-btn"
                    style={{ justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}
                  >
                    <Download size={15} />
                    <span>{lang === 'es' ? 'Exportar como Respaldo JSON completo' : 'Export as Complete JSON Backup'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportTXT(true)}
                    className="reset-filter-btn"
                    style={{ justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}
                  >
                    <FileText size={15} />
                    <span>{lang === 'es' ? 'Exportar palabras "Conocido" (.txt plano)' : 'Export "Known" words (.txt list)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportTXT(false)}
                    className="reset-filter-btn"
                    style={{ justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}
                  >
                    <FileText size={15} />
                    <span>{lang === 'es' ? 'Exportar todas las palabras guardadas (.txt plano)' : 'Export all saved words (.txt list)'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 4. ACTIONS TAB */}
            {activeTab === 'actions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                <div className="settings-section-card" style={{ margin: 0 }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Database size={15} style={{ color: 'var(--primary)' }} />
                    <span>{lang === 'es' ? 'Marcar palabras conocidas mediante composición' : 'Mark Words as Known via Composition'}</span>
                  </h4>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', marginBottom: '12px' }}>
                    {lang === 'es'
                      ? 'Analiza las palabras conocidas complejas (de longitud > 1) y extrae sus palabras componentes para agregarlas como conocidas automáticamente (ej. si conoces "突っ込む", agregará "突く" y "込む").'
                      : 'Analyzes complex known words (length > 1) and extracts their component words to automatically add them as known too (e.g. if you know "突っ込む", it adds "突く" and "込む").'}
                  </p>
                  <button
                    type="button"
                    onClick={handleExpandComponents}
                    className="reset-filter-btn"
                    style={{ background: 'rgba(99, 102, 241, 0.05)', borderColor: '#8b5cf6', color: '#a78bfa' }}
                  >
                    {lang === 'es' ? 'Analizar y expandir componentes' : 'Analyze & Expand Components'}
                  </button>
                </div>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

                <div className="settings-section-card" style={{ margin: 0, borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.02)' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f87171', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={15} style={{ color: '#ef4444' }} />
                    <span>{lang === 'es' ? 'Zona de peligro' : 'Danger Zone'}</span>
                  </h4>
                  <p style={{ fontSize: '0.72rem', color: 'rgba(239, 68, 68, 0.65)', lineHeight: '1.4', marginBottom: '12px' }}>
                    {lang === 'es'
                      ? 'Vacía de forma permanente todas las palabras conocidas, en aprendizaje e ignoradas. Esta acción no se puede deshacer.'
                      : 'Permanently deletes all known, learning, and ignored words. This action is irreversible.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleClearVocabulary}
                    className="reset-filter-btn"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#f87171' }}
                  >
                    {lang === 'es' ? 'Eliminar todo el vocabulario' : 'Clear All Vocabulary'}
                  </button>
                </div>

              </div>
            )}

          </div>

          {/* Bottom Progress Bar */}
          {isLoading && (
            <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.4)', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <RefreshCw size={16} className="spin" style={{ color: 'var(--primary)' }} />
              <span style={{ fontSize: '0.8rem', color: '#fff', fontWeight: 600 }}>{progressMsg}</span>
            </div>
          )}

        </div>
      </div>
      {confirmModal}
      {isCardsModalOpen && (
        <AnkiCardsModal
          lang={lang}
          settings={ankiSettings}
          availableDecks={availableDecks}
          availableModels={availableModels}
          onSave={(updated: any) => {
            const newSetts = { ...ankiSettings, ...updated };
            setAnkiSettings(newSetts);
            localStorage.setItem('anki_settings_v2', JSON.stringify(newSetts));
            const tab = newSetts.expression || {};
            const fields = tab.fields || {};
            const findField = (token: string) => Object.keys(fields).find(k => fields[k] === token) || '';
            localStorage.setItem('anki_settings', JSON.stringify({
              host: newSetts.host,
              deck: tab.deck || '',
              noteType: tab.noteType || '',
              tags: newSetts.tags,
              wordField: newSetts.importWordField || findField('{expression}'),
              readingField: findField('{reading}'),
              meaningField: findField('{meaning}'),
              sentenceField: findField('{sentence}'),
            }));
          }}
          onClose={() => setIsCardsModalOpen(false)}
        />
      )}
    </>
  );
}

const AVAILABLE_TOKENS = [
  '', 
  '{expression}', 
  '{furigana}', 
  '{furigana-plain}',
  '{reading}', 
  '{audio}', 
  '{popup-selection-text}', 
  '{sentence}', 
  '{sentence-furigana}', 
  '{sentence-furigana-plain}',
  '{sentence-audio}',
  '{sentence-cloze}',
  '{screenshot}', 
  '{meaning}', 
  '{glossary}',
  '{glossary-brief}',
  '{glossary-first}',
  '{glossary-first-brief}',
  '{glossary-no-dictionary}',
  '{glossary-plain}',
  '{glossary-plain-no-dictionary}',
  '{tags}', 
  '{pitch-accent-positions}', 
  '{pitch-accent-categories}', 
  '{pitch-accent-graphs}', 
  '{pitch-accent-graphs-jj}',
  '{pitch-accents}',
  '{frequency-harmonic-rank}', 
  '{frequencies}', 
  '{single-frequency-number-bccwj}',
  '{single-frequency-number-jiten-anime}',
  '{single-frequency-number-jpdb}',
  '{single-frequency-number-vn-freq}',
  '{cloze-prefix}',
  '{cloze-body}',
  '{cloze-body-kana}',
  '{cloze-suffix}',
  '{document-title}',
  '{search-query}',
  '{part-of-speech}',
  '{bilingual}', 
  '{monolingual-primary}', 
  '{monolingual-extra}',
  '{clipboard-text}',
  '{clipboard-image}',
  '{url}',
];

const getAutoMappedToken = (fName: string) => {
  const lower = fName.toLowerCase().replace(/[-_]/g, '');
  
  if (lower.includes('furigana')) {
    if (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto') || lower.includes('sent')) {
      if (lower.includes('plain')) return '{sentence-furigana-plain}';
      return '{sentence-furigana}';
    }
    if (lower.includes('plain')) return '{furigana-plain}';
    return '{furigana}';
  }
  
  if (lower.includes('audio')) {
    if (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto') || lower.includes('sent')) {
      return '{sentence-audio}';
    }
    return '{audio}';
  }
  
  if (lower.includes('reading') || lower.includes('lectura') || lower === 'yomi' || lower.includes('kana') || lower.includes('pronunciation')) {
    if (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto') || lower.includes('sent')) {
      return '{sentence-furigana-plain}';
    }
    return '{reading}';
  }
  
  if (lower.includes('cloze') || lower.includes('clozed')) {
    return '{sentence-cloze}';
  }
  
  if (lower.includes('english') || lower.includes('meaning') || lower.includes('definition') || lower.includes('significado') || lower.includes('definicion') || lower.includes('glossary') || lower.includes('notes') || lower === 'translation') {
    if (lower.includes('bilingual') || lower.includes('bilingue')) {
      return '{bilingual}';
    }
    return '{meaning}';
  }
  
  if (lower.includes('bilingual') || lower.includes('bilingue')) {
    return '{bilingual}';
  }
  
  if (lower.includes('monolingual') || lower.includes('monolingue')) {
    if (lower.includes('extra') || lower.includes('secundario') || lower.includes('add') || lower.includes('more')) {
      return '{monolingual-extra}';
    }
    return '{monolingual-primary}';
  }
  
  if (lower.includes('kanji') || lower.includes('expression') || lower.includes('word') || lower.includes('vocablo') || lower.includes('palabra') || lower.includes('vocab') || lower.includes('term')) {
    if (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto') || lower.includes('sent')) {
      return '{sentence}';
    }
    return '{expression}';
  }
  
  if (lower.includes('screenshot') || lower.includes('picture') || lower.includes('imagen') || lower === 'pic' || lower.includes('image') || lower.includes('img') || lower.includes('foto')) {
    return '{screenshot}';
  }
  
  if (lower.includes('partofspeech') || lower === 'pos' || lower.includes('category') || lower === 'clase') {
    return '{part-of-speech}';
  }
  
  if (lower.includes('pitch')) {
    if (lower.includes('num') || lower.includes('pos') || lower.includes('position') || lower.includes('acc') || lower.includes('accent')) {
      return '{pitch-accent-positions}';
    }
    if (lower.includes('graph') || lower.includes('draw') || lower.includes('line') || lower.includes('visual')) {
      return '{pitch-accent-graphs}';
    }
    if (lower.includes('category') || lower.includes('cat') || lower.includes('pattern') || lower.includes('type') || lower.includes('clase') || lower.includes('estilo')) {
      return '{pitch-accent-categories}';
    }
    return '{pitch-accent-graphs}';
  }
  
  if (lower.includes('frequency') || lower.includes('frecuencia') || lower === 'freq' || lower.includes('frequencies')) {
    if (lower.includes('sorted') || lower.includes('rank') || lower.includes('harmonic') || lower.includes('best')) {
      return '{frequency-harmonic-rank}';
    }
    return '{frequencies}';
  }
  
  if (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto') || lower === 'sent') {
    return '{sentence}';
  }
  
  return '';
};

interface AnkiCardsModalProps {
  settings: any;
  onSave: (settings: any) => void;
  onClose: () => void;
  availableDecks: string[];
  availableModels: string[];
  lang: string;
}

function AnkiCardsModal({ settings, onSave, onClose, availableDecks, availableModels, lang }: AnkiCardsModalProps) {
  const [activeTab, setActiveTab] = useState<'expression' | 'reading' | 'kanji'>('expression');
  const [local, setLocal] = useState<any>(settings);
  const [modelFields, setModelFields] = useState<string[]>([]);

  const tab = local[activeTab] || { deck: '', noteType: '', fields: {} };

  const setTabField = (key: string, value: any) =>
    setLocal((s: any) => ({ ...s, [activeTab]: { ...s[activeTab], [key]: value } }));

  const setFieldToken = (fieldName: string, token: string) =>
    setLocal((s: any) => ({
      ...s,
      [activeTab]: {
        ...s[activeTab],
        fields: { ...s[activeTab].fields, [fieldName]: token }
      }
    }));

  const handleAutoMapFields = () => {
    if (!modelFields || modelFields.length === 0) return;
    setLocal((s: any) => {
      const updatedFields: any = {};
      modelFields.forEach(fName => {
        updatedFields[fName] = getAutoMappedToken(fName);
      });
      return {
        ...s,
        [activeTab]: {
          ...s[activeTab],
          fields: updatedFields
        }
      };
    });
  };

  useEffect(() => {
    let active = true;
    async function fetchFields() {
      if (!tab.noteType) return;
      try {
        const host = local.host || 'http://127.0.0.1:8765';
        const data = await ankiConnectRequest<string[]>(host, {
          action: 'modelFieldNames',
          version: 6,
          params: { modelName: tab.noteType },
          ...(local.apiKey ? { key: local.apiKey } : {})
        });
        if (data && data.result && active) {
          setModelFields(data.result);
          
          setLocal((s: any) => {
            const currentFields = s[activeTab]?.fields || {};
            const updatedFields: any = {};
            let changed = false;
            data.result.forEach((fName: string) => {
              if (currentFields[fName] !== undefined) {
                const lower = fName.toLowerCase();
                const isSentenceFurigana = (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto')) && lower.includes('furigana');
                const isSentenceAudio = (lower.includes('sentence') || lower.includes('frase') || lower.includes('oracion') || lower.includes('contexto')) && lower.includes('audio');
                if (isSentenceFurigana && currentFields[fName] === '{furigana}') {
                  updatedFields[fName] = '{sentence-furigana}';
                  changed = true;
                } else if (isSentenceAudio && currentFields[fName] === '{audio}') {
                  updatedFields[fName] = '{sentence-audio}';
                  changed = true;
                } else {
                  updatedFields[fName] = currentFields[fName];
                }
              } else {
                updatedFields[fName] = getAutoMappedToken(fName);
                changed = true;
              }
            });
            
            const oldKeys = Object.keys(currentFields);
            const keysDifference = oldKeys.filter(x => !data.result.includes(x));
            if (keysDifference.length > 0) changed = true;

            if (changed || Object.keys(updatedFields).length !== oldKeys.length) {
              return {
                ...s,
                [activeTab]: {
                  ...s[activeTab],
                  fields: updatedFields
                }
              };
            }
            return s;
          });
        }
      } catch (err) {
        console.warn('Failed to fetch model field names:', err);
      }
    }
    fetchFields();
    return () => { active = false; };
  }, [tab.noteType, activeTab]);

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1500 }}>
      <div className="yomitan-cards-modal" onClick={e => e.stopPropagation()} style={{ width: '480px', maxWidth: '90vw' }}>
        <div className="yomitan-cards-title">{lang === 'es' ? 'Campos de tarjeta de Anki' : 'Anki Card Fields'}</div>

        <div className="yomitan-cards-tabs">
          {['expression', 'reading', 'kanji'].map(t => (
            <button
              key={t}
              className={`yomitan-cards-tab ${activeTab === t ? 'active' : ''}`}
              onClick={() => setActiveTab(t as any)}
            >
              {t === 'expression' ? (lang === 'es' ? 'Expresión' : 'Expression') :
               t === 'reading' ? (lang === 'es' ? 'Lectura' : 'Reading') :
               (lang === 'es' ? 'Kanji' : 'Kanji')}
            </button>
          ))}
        </div>

        <div className="yomitan-cards-body" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <div className="yomitan-cards-row">
            <span className="yomitan-cards-label">{lang === 'es' ? 'Mazo' : 'Deck'}</span>
            <div className="yomitan-cards-input-wrap">
              <select
                className="yomitan-cards-select"
                value={tab.deck}
                onChange={e => setTabField('deck', e.target.value)}
              >
                {availableDecks.length > 0
                  ? availableDecks.map(d => <option key={d} value={d}>{d}</option>)
                  : <option value={tab.deck}>{tab.deck || 'sentence mining'}</option>
                }
              </select>
            </div>
          </div>

          <div className="yomitan-cards-row">
            <span className="yomitan-cards-label">{lang === 'es' ? 'Modelo' : 'Model'}</span>
            <div className="yomitan-cards-input-wrap">
              <select
                className="yomitan-cards-select"
                value={tab.noteType}
                onChange={e => setTabField('noteType', e.target.value)}
              >
                {availableModels.length > 0
                  ? availableModels.map(m => <option key={m} value={m}>{m}</option>)
                  : <option value={tab.noteType}>{tab.noteType || 'Lapis'}</option>
                }
              </select>
            </div>
          </div>

          <div className="yomitan-fields-divider" />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px', marginTop: '4px' }}>
            <button
              type="button"
              className="yomitan-cards-btn-automap"
              onClick={handleAutoMapFields}
              style={{
                background: 'linear-gradient(135deg, var(--primary, #f2c866) 0%, #ff8c00 100%)',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 14px rgba(242, 200, 102, 0.25)',
                letterSpacing: '0.02em'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.filter = 'brightness(1.15)';
                e.currentTarget.style.transform = 'translateY(-1.5px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(242, 200, 102, 0.4)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.filter = 'none';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(242, 200, 102, 0.25)';
              }}
            >
              <span>✨ {lang === 'es' ? 'Auto-mapear campos' : 'Auto-map fields'}</span>
            </button>
          </div>

          <div className="yomitan-fields-header">
            <span>{lang === 'es' ? 'Campo' : 'Field'}</span>
            <span>{lang === 'es' ? 'Valor' : 'Value'}</span>
          </div>

          {Object.entries(tab.fields || {}).map(([fieldName, token]) => (
            <div key={fieldName} className="yomitan-cards-row">
              <span className="yomitan-cards-label">{fieldName}</span>
              <div className="yomitan-cards-input-wrap">
                <select
                  className="yomitan-cards-select"
                  value={token as string}
                  onChange={e => setFieldToken(fieldName, e.target.value)}
                >
                  {AVAILABLE_TOKENS.map(t => (
                    <option key={t} value={t}>{t || (lang === 'es' ? '(vacío)' : '(empty)')}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="yomitan-cards-footer">
          <button className="yomitan-cards-help-btn" onClick={() => {}}>{lang === 'es' ? 'Ayuda' : 'Help'}</button>
          <button
            className="yomitan-cards-close-btn"
            onClick={() => { onSave(local); onClose(); }}
          >
            {lang === 'es' ? 'Guardar y cerrar' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
