import { State } from './fsrs';

/**
 * Per-deck SRS options, stored in the profile settings (`srsDeckOptions`) keyed by deck name.
 * Every field is optional: a missing value falls back to the global SRS setting.
 */
export type SrsCardFront = 'word' | 'sentence' | 'audio';

export interface SrsDeckOptions {
  newPerDay?: number;
  reviewsPerDay?: number;
  cardFront?: SrsCardFront;
  paused?: boolean;
}

export const DEFAULT_DECK_NAME = 'Yoru Reader';

export function getDeckName(card: any): string {
  return (card?.source || DEFAULT_DECK_NAME).trim();
}

export function getAllDeckOptions(settings: any): Record<string, SrsDeckOptions> {
  const raw = settings?.srsDeckOptions;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function getDeckOptions(settings: any, deckName: string): SrsDeckOptions {
  return getAllDeckOptions(settings)[deckName] || {};
}

/** Returns new settings with `deckName`'s options replaced (or removed when `options` is null). */
export function withDeckOptions(settings: any, deckName: string, options: SrsDeckOptions | null): any {
  const all = { ...getAllDeckOptions(settings) };
  if (options === null) delete all[deckName];
  else all[deckName] = options;
  return { ...settings, srsDeckOptions: all };
}

const toLimit = (value: unknown): number | null => {
  const n = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n));
};

/**
 * How many new cards and reviews each deck may still show today under its own limits
 * (Infinity when the deck has no limit of its own). The global limits apply on top.
 */
export function getDeckLimitsLeft(
  settings: any,
  srsData: Record<string, any>,
  todayHistory: any[],
  newWordsToday: Iterable<string>,
) {
  const newDone: Record<string, number> = {};
  for (const word of newWordsToday) {
    const deck = getDeckName(srsData[word]);
    newDone[deck] = (newDone[deck] || 0) + 1;
  }
  const reviewsDone: Record<string, number> = {};
  todayHistory.forEach((entry: any) => {
    const isReview = entry.reviewState !== undefined ? entry.reviewState === State.Review : !entry.isNew;
    if (!isReview) return;
    const deck = (entry.deckName || getDeckName(srsData[entry.word])).trim();
    reviewsDone[deck] = (reviewsDone[deck] || 0) + 1;
  });

  const newLeft = (deck: string) => {
    const limit = toLimit(getDeckOptions(settings, deck).newPerDay);
    return limit === null ? Infinity : Math.max(0, limit - (newDone[deck] || 0));
  };
  const reviewsLeft = (deck: string) => {
    const limit = toLimit(getDeckOptions(settings, deck).reviewsPerDay);
    return limit === null ? Infinity : Math.max(0, limit - (reviewsDone[deck] || 0));
  };
  const isPaused = (deck: string) => Boolean(getDeckOptions(settings, deck).paused);
  return { newLeft, reviewsLeft, isPaused };
}
