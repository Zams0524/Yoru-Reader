import { isNewSrsCard, State } from './fsrs';
import { getDeckLimitsLeft, getDeckName } from './srsDeckOptions';
import { isSrsCardInactive, srsWordOfKey } from './srsCardKeys';

/**
 * How many SRS cards will be waiting at a given moment if nothing is reviewed before it, with the
 * same rules as the SRS dashboard (Library's deck list): global and per-deck daily limits, paused
 * decks, inactive cards, and Anki's 20-minute learn-ahead for learning steps. Used for the daily
 * reminder, worked out ahead for the coming days.
 */

export interface SrsDueForecast {
  total: number;
  reviews: number;
  learning: number;
  fresh: number;
  /** A few of the new cards' words, for the reminder text. */
  newWords: string[];
}

const LEARN_AHEAD_MS = 20 * 60 * 1000;

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function cardDueDate(card: any): Date | null {
  for (const value of [card?.due, card?.dueDate]) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

export function forecastSrsDue(
  at: Date,
  srsData: Record<string, any>,
  statuses: Record<string, string>,
  settings: any,
  history: any[],
  dailyReviewStats: Record<string, { reviews?: number; newWords?: string[] }>,
): SrsDueForecast {
  // What was already studied on that day counts against its limits (only today has any).
  const day = localDate(at);
  const dayHistory = history.filter((entry: any) => entry?.timestamp
    && Number.isFinite(new Date(entry.timestamp).getTime())
    && localDate(new Date(entry.timestamp)) === day);
  const dailyStats = dailyReviewStats[day];
  const newStudied = new Set<string>([
    ...dayHistory.filter((entry: any) => entry.isNew && entry.word).map((entry: any) => entry.word),
    ...(Array.isArray(dailyStats?.newWords) ? dailyStats!.newWords! : []),
  ]);
  const reviewsFromHistory = dayHistory.filter((entry: any) => entry.reviewState !== undefined
    ? entry.reviewState === State.Review
    : !entry.isNew).length;
  const reviewsDone = Math.max(reviewsFromHistory, Number(dailyStats?.reviews) || 0);

  const limit = (value: unknown, fallback: number) => {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
  };
  let newLeft = Math.max(0, limit(settings?.srsNewCardsPerDay, 20) - newStudied.size);
  let reviewsLeft = Math.max(0, limit(settings?.srsMaxReviewsPerDay, 200) - reviewsDone);
  const deckLimits = getDeckLimitsLeft(settings, srsData, dayHistory, newStudied);
  const deckNewLeft: Record<string, number> = {};
  const deckReviewsLeft: Record<string, number> = {};

  const result: SrsDueForecast = { total: 0, reviews: 0, learning: 0, fresh: 0, newWords: [] };
  const time = at.getTime();
  for (const [key, card] of Object.entries(srsData)) {
    if (key.startsWith('_deck_') || !card || isSrsCardInactive(key, card, statuses)) continue;
    const deck = getDeckName(card);
    if (!deck || deckLimits.isPaused(deck)) continue;
    if (!(deck in deckNewLeft)) {
      deckNewLeft[deck] = deckLimits.newLeft(deck);
      deckReviewsLeft[deck] = deckLimits.reviewsLeft(deck);
    }
    const isNew = isNewSrsCard(card);
    const isLearning = !isNew && (card.state === State.Learning || card.state === State.Relearning);
    const due = cardDueDate(card);
    if (due && due.getTime() > time + (isLearning ? LEARN_AHEAD_MS : 0)) continue;
    if (isNew) {
      if (newLeft <= 0 || deckNewLeft[deck] <= 0) continue;
      newLeft--;
      deckNewLeft[deck]--;
      result.fresh++;
      if (result.newWords.length < 2) result.newWords.push(srsWordOfKey(key));
    } else if (isLearning) {
      result.learning++;
    } else {
      if (reviewsLeft <= 0 || deckReviewsLeft[deck] <= 0) continue;
      reviewsLeft--;
      deckReviewsLeft[deck]--;
      result.reviews++;
    }
  }
  result.total = result.reviews + result.learning + result.fresh;
  return result;
}

/** The last day anything was reviewed (local date string), or null. */
export function lastStudyDay(history: any[]): string | null {
  let last: number | null = null;
  for (const entry of history) {
    const time = entry?.timestamp ? new Date(entry.timestamp).getTime() : NaN;
    if (Number.isFinite(time) && (last === null || time > last)) last = time;
  }
  return last === null ? null : localDate(new Date(last));
}
