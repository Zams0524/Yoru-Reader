// Turns Anki cards (from an .apkg/.colpkg file or from AnkiConnect) into Yoru SRS cards, one Yoru
// card per Anki card: same state, due date, counters, FSRS memory state and review history, so the
// deck in Yoru starts out as a copy of the deck in Anki.
import { FSRSAlgorithm, generatorParameters } from 'ts-fsrs';
import { State } from './fsrs';

/** One Anki revlog entry. `rating` 0 is a manual entry (reschedule/forget), with no answer. */
export interface AnkiReview {
  /** Review time, epoch ms (the revlog id). */
  at: number;
  rating: number;
  /** Revlog type: 0 Learn, 1 Review, 2 Relearn, 3 Filtered, 4 Manual, 5 Rescheduled. */
  type: number;
  /** Interval after the review: days when positive, seconds when negative. */
  ivl: number;
}

export interface AnkiImportCard {
  cardId?: number;
  noteId?: number;
  word: string;
  reading?: string;
  deck: string;
  /** Anki card type: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  type: number;
  /** Anki queue: -1 suspended, -2/-3 buried, 0 new, 1 learning, 2 review, 3 day-learning. */
  queue?: number;
  interval: number;
  reps: number;
  lapses: number;
  /** Anki's ease factor * 1000 (e.g. 2500 = 250%). */
  factor: number;
  /** Raw Anki `due`: queue position (new), epoch seconds (learning) or day number (review). */
  due?: number;
  /** Last-modified time, epoch seconds. */
  mod?: number;
  /** FSRS memory state Anki stored for the card, when the deck uses FSRS. */
  memory?: { stability: number; difficulty: number } | null;
  /** Last review time Anki stored with the memory state, epoch seconds. */
  lastReviewSeconds?: number;
  reviews?: AnkiReview[];
}

/** Anki's default "Next day starts at" hour, the same one Yoru uses for Review-state due dates. */
const ROLLOVER_HOUR = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since the epoch of the study day `ms` falls in (a study day starts at ROLLOVER_HOUR local time). */
function studyDayNumber(ms: number): number {
  const d = new Date(ms - ROLLOVER_HOUR * 60 * 60 * 1000);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** ROLLOVER_HOUR local time on the given study day. */
function studyDayStart(dayNumber: number): Date {
  const utc = new Date(dayNumber * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), ROLLOVER_HOUR, 0, 0, 0);
}

function sortedAnswers(reviews: AnkiReview[] | undefined): AnkiReview[] {
  return (reviews || []).filter((r) => r.rating >= 1 && r.rating <= 4).sort((a, b) => a.at - b.at);
}

/**
 * The card's next due date. Review cards and day-learning cards store a day number counted from
 * the collection's creation (`crtSeconds`, known from an .apkg file). Without it (AnkiConnect),
 * the day is rebuilt from the last review plus the interval, the way Anki computed it.
 */
export function resolveAnkiDue(card: AnkiImportCard, crtSeconds: number | null, now: Date = new Date()): Date | null {
  const raw = Number(card.due) || 0;
  if (card.type === 0) return null;
  if ((card.type === 1 || card.type === 3) && raw > 1e9) return new Date(raw * 1000);

  if (crtSeconds) {
    return studyDayStart(studyDayNumber(crtSeconds * 1000 + 12 * 60 * 60 * 1000) + raw);
  }
  const answers = sortedAnswers(card.reviews);
  const lastReviewMs = answers.length
    ? answers[answers.length - 1].at
    : (card.lastReviewSeconds ? card.lastReviewSeconds * 1000 : (card.mod ? card.mod * 1000 : 0));
  if (!lastReviewMs) return now;
  if (card.type !== 2) return now;
  return studyDayStart(studyDayNumber(lastReviewMs) + Math.max(0, card.interval || 0));
}

/**
 * Whether the collection's creation time matches the cards' review history: for review cards,
 * the crt-based due day should match last review + interval for most cards. Returns crtSeconds,
 * or null when it doesn't match (then due dates are rebuilt from each card's history instead).
 */
export function verifiedCrt(cards: AnkiImportCard[], crtSeconds: number | null): number | null {
  if (!crtSeconds) return null;
  const crtDay = studyDayNumber(crtSeconds * 1000 + 12 * 60 * 60 * 1000);
  const offsets: number[] = [];
  for (const card of cards) {
    if (card.type !== 2) continue;
    const answers = sortedAnswers(card.reviews);
    if (!answers.length) continue;
    const expected = studyDayNumber(answers[answers.length - 1].at) + Math.max(0, card.interval || 0);
    offsets.push(crtDay + (Number(card.due) || 0) - expected);
    if (offsets.length >= 500) break;
  }
  if (!offsets.length) return crtSeconds;
  offsets.sort((a, b) => a - b);
  return Math.abs(offsets[Math.floor(offsets.length / 2)]) <= 2 ? crtSeconds : null;
}

let fsrsAlgorithm: FSRSAlgorithm | null = null;

/**
 * Rebuilds the FSRS memory state (stability, difficulty) from the card's review history, the way
 * Anki does when FSRS is turned on for a deck that was studied with SM-2.
 */
export function memoryFromReviews(reviews: AnkiReview[] | undefined): { stability: number; difficulty: number } | null {
  if (!fsrsAlgorithm) fsrsAlgorithm = new FSRSAlgorithm(generatorParameters());
  let memory: { stability: number; difficulty: number } | null = null;
  let lastDay: number | null = null;
  for (const review of [...(reviews || [])].sort((a, b) => a.at - b.at)) {
    if (review.type === 4 && review.ivl === 0 && review.rating === 0) {
      // "Forget" / reset to new: Anki starts the memory state over.
      memory = null;
      lastDay = null;
      continue;
    }
    if (review.rating < 1 || review.rating > 4) continue;
    const day = studyDayNumber(review.at);
    const elapsed = lastDay === null ? 0 : Math.max(0, day - lastDay);
    memory = fsrsAlgorithm.next_state(memory, elapsed, review.rating);
    lastDay = day;
  }
  return memory;
}

/** The Yoru SRS card for one Anki card. */
export function buildSrsCardFromAnki(card: AnkiImportCard, crtSeconds: number | null, now: Date = new Date()): Record<string, any> {
  const state = [0, 1, 2, 3].includes(card.type) ? card.type : (card.interval > 0 ? State.Review : State.New);
  const answers = sortedAnswers(card.reviews);
  const lastReviewMs = state === State.New
    ? 0
    : answers.length
      ? answers[answers.length - 1].at
      : (card.lastReviewSeconds ? card.lastReviewSeconds * 1000 : (card.mod ? card.mod * 1000 : 0));
  const memory = state === State.New ? null : (card.memory || memoryFromReviews(card.reviews));
  const interval = state === State.Review ? Math.max(0, card.interval || 0) : 0;

  const data: Record<string, any> = {
    state,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    interval,
    scheduled_days: interval,
    learning_steps: 0,
    ease: Math.max(1.3, Math.min(5, (card.factor || 2500) / 1000)),
    // Undefined (dropped when saved) when there is none, so a stale value from an earlier
    // import or from Yoru reviews never mixes with this card's Anki state.
    stability: memory?.stability,
    difficulty: memory?.difficulty,
    suspended: card.queue === -1 ? true : undefined,
    newPosition: state === State.New && Number.isFinite(card.due) ? card.due : undefined,
    source: card.deck,
    word: card.word,
    ankiCardId: card.cardId,
    ankiNoteId: card.noteId,
    // Newer than any removal of this key on another device, so a sync keeps the card.
    importedAt: now.toISOString(),
  };
  if (card.reading) data.reading = card.reading;

  const due = resolveAnkiDue(card, crtSeconds, now);
  if (due) {
    data.due = due.toISOString();
    data.dueDate = data.due;
  } else {
    data.due = undefined;
    data.dueDate = undefined;
  }
  if (lastReviewMs) {
    data.last_review = new Date(lastReviewMs).toISOString();
    data.lastReview = data.last_review;
  } else {
    data.last_review = undefined;
    data.lastReview = undefined;
  }
  return data;
}

/**
 * The srsData key for each Anki card. A card imported before keeps its key. Otherwise the most
 * advanced card of each word takes the plain word key (the one the reader looks up), unless a card
 * from another Anki deck already owns it; the rest get `word:reading:<card id>`.
 */
export function assignAnkiSrsKeys(cards: AnkiImportCard[], existing: Record<string, any>): Map<AnkiImportCard, string> {
  const keys = new Map<AnkiImportCard, string>();
  const used = new Set<string>();
  const existingKeyByCardId = new Map<number, string>();
  for (const [key, value] of Object.entries(existing)) {
    if (!key.startsWith('_deck_') && value && Number.isFinite(value.ankiCardId)) existingKeyByCardId.set(value.ankiCardId, key);
  }

  const remaining: AnkiImportCard[] = [];
  for (const card of cards) {
    const key = card.cardId !== undefined ? existingKeyByCardId.get(card.cardId) : undefined;
    if (key && !used.has(key)) {
      keys.set(card, key);
      used.add(key);
    } else {
      remaining.push(card);
    }
  }

  remaining.sort((a, b) => (b.interval || 0) - (a.interval || 0) || (a.cardId || 0) - (b.cardId || 0));
  remaining.forEach((card, index) => {
    const owner = existing[card.word];
    const plainFree = !used.has(card.word) && (!owner || !Number.isFinite(owner.ankiCardId));
    let key = card.word;
    if (!plainFree) {
      key = `${card.word}:${card.reading || ''}:${card.cardId ?? `n${index}`}`;
      while (used.has(key)) key += '_';
    }
    keys.set(card, key);
    used.add(key);
  });
  return keys;
}

function localYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ImportedReviewDay {
  /** Every answer that day (the activity heatmap count). */
  total: number;
  /** Answers on cards in Review state (the daily review limit count). */
  reviews: number;
  /** Cards first studied that day, by srsData key. */
  newWords: string[];
}

/** Anki's review history per local calendar day, in the shape Yoru keeps its own daily counters. */
export function summarizeAnkiReviewsByDay(entries: { key: string; reviews?: AnkiReview[] }[]): Record<string, ImportedReviewDay> {
  const days: Record<string, ImportedReviewDay> = {};
  const day = (ymd: string) => (days[ymd] ||= { total: 0, reviews: 0, newWords: [] });
  for (const { key, reviews } of entries) {
    const answers = sortedAnswers(reviews);
    answers.forEach((review, index) => {
      const entry = day(localYmd(review.at));
      entry.total += 1;
      if (review.type === 1) entry.reviews += 1;
      if (index === 0 && review.type === 0) entry.newWords.push(key);
    });
  }
  return days;
}

/** Card counts per state, with the same young/mature split (21 days) as Anki and Yoru's stats. */
export function countSrsStates(cards: Record<string, any>[]) {
  const counts = { total: 0, new: 0, learning: 0, relearning: 0, young: 0, mature: 0, suspended: 0 };
  for (const card of cards) {
    counts.total += 1;
    if (card.suspended) counts.suspended += 1;
    if (card.state === State.Learning) counts.learning += 1;
    else if (card.state === State.Relearning) counts.relearning += 1;
    else if (card.state === State.Review) {
      if ((card.scheduled_days || 0) >= 21) counts.mature += 1;
      else counts.young += 1;
    } else counts.new += 1;
  }
  return counts;
}

export interface AnkiImportPlan {
  /** srsData key -> Yoru card, ready for db.saveSrsCardsBatch. */
  cards: Record<string, Record<string, any>>;
  /** Review history per day, ready for db.mergeImportedSrsReviewDays. */
  reviewDays: Record<string, ImportedReviewDay>;
  reviewCount: number;
  counts: ReturnType<typeof countSrsStates>;
}

/**
 * Plans an import without saving anything: one Yoru card per Anki card in `cards`, plus the words
 * pulled out of sentence cards (`sentenceCards`, one per word, only where no card owns the word),
 * and the review history of every imported card.
 */
export function planAnkiImport(options: {
  cards: AnkiImportCard[];
  sentenceCards?: AnkiImportCard[];
  /** Review history of the sentence cards, by the first word taken from each. */
  sentenceHistory?: { word: string; reviews?: AnkiReview[] }[];
  crtSeconds: number | null;
  existing: Record<string, any>;
  now?: Date;
}): AnkiImportPlan {
  const now = options.now || new Date();
  const crtSeconds = verifiedCrt(options.cards, options.crtSeconds);
  const keys = assignAnkiSrsKeys(options.cards, options.existing);
  const cards: Record<string, Record<string, any>> = {};
  const historyEntries: { key: string; reviews?: AnkiReview[] }[] = [];
  for (const card of options.cards) {
    const key = keys.get(card)!;
    cards[key] = buildSrsCardFromAnki(card, crtSeconds, now);
    historyEntries.push({ key, reviews: card.reviews });
  }
  const sentenceCards = [...(options.sentenceCards || [])].sort((a, b) => (b.interval || 0) - (a.interval || 0));
  for (const card of sentenceCards) {
    if (cards[card.word] || Number.isFinite(options.existing[card.word]?.ankiCardId)) continue;
    cards[card.word] = buildSrsCardFromAnki({ ...card, cardId: undefined, noteId: undefined }, crtSeconds, now);
  }
  for (const { word, reviews } of options.sentenceHistory || []) historyEntries.push({ key: word, reviews });

  const reviewDays = summarizeAnkiReviewsByDay(historyEntries);
  const reviewCount = Object.values(reviewDays).reduce((sum, day) => sum + day.total, 0);
  return { cards, reviewDays, reviewCount, counts: countSrsStates(Object.values(cards)) };
}

/**
 * Cards already in Yoru that a whole-deck import replaces but does not bring back: copies of the
 * same Anki cards under another key, and cards from the imported decks that are not in the file
 * (earlier imports keyed by word, words taken from sentences, cards since deleted in Anki). Left in
 * place they add to the deck's totals and due counts, so the deck no longer matches Anki.
 * `deckKey` normalizes a deck name the way stored card sources are (Anki writes subdecks with ::).
 */
export function findReplacedAnkiCards(
  plan: AnkiImportPlan,
  importedCards: AnkiImportCard[],
  existing: Record<string, any>,
  deckKey: (name: string) => string,
): string[] {
  const cardIds = new Set(importedCards.map((card) => card.cardId).filter((id): id is number => Number.isFinite(id)));
  const decks = new Set(importedCards.map((card) => deckKey(card.deck)).filter(Boolean));
  const inImportedDeck = (source: unknown) => {
    if (typeof source !== 'string' || !source) return false;
    const key = deckKey(source);
    for (const deck of decks) if (key === deck || key.startsWith(`${deck}::`)) return true;
    return false;
  };
  return Object.entries(existing)
    .filter(([key, card]) => !key.startsWith('_deck_') && card && !(key in plan.cards)
      && (cardIds.has(card.ankiCardId) || inImportedDeck(card.source)))
    .map(([key]) => key);
}

const WORD_FIELD_PREFERENCES = ['vocabulary-kanji', 'vocabulary-kana', 'word', 'kanji', 'vocabulary', 'front', 'expression'];
const fieldKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The field that holds each card's word. The configured field wins, except where it looks like a
 * sentence field and the deck has a vocabulary field: there it would split every example sentence
 * into words (Core 2k/6k keeps its example sentence in "Expression", the old default). `keepManual`
 * keeps a field the user picked by hand for this deck (AnkiConnect); a file is another deck.
 */
export function chooseAnkiWordField(fieldNames: string[], configured: string, keepManual: boolean): string {
  const byKey = new Map(fieldNames.map((name) => [fieldKey(name), name]));
  const recommended = WORD_FIELD_PREFERENCES.map((name) => byKey.get(fieldKey(name))).find(Boolean) || fieldNames[0] || '';
  const hasVocabularyField = fieldNames.some((name) => /vocabulary|word|kanji/i.test(name));
  const looksLikeSentenceField = /sentence|example|context|cloze|expression/i.test(configured);
  const replace = !keepManual && hasVocabularyField && looksLikeSentenceField;
  return fieldNames.includes(configured) && !replace ? configured : recommended;
}
