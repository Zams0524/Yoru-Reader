import {
  fsrs as createFsrs,
  createEmptyCard as createLibraryCard,
  Rating as LibraryRating,
  State as LibraryState,
  type Card as LibraryCard,
} from 'ts-fsrs';

export enum State {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export enum Rating {
  Manual = 0,
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

export const isNewSrsCard = (card: any): boolean => {
  if (!card) return true;
  if (card.state === State.New) return true;
  if ([State.Learning, State.Review, State.Relearning].includes(card.state)) return false;
  return Number(card.repetitions ?? card.reps ?? 0) <= 0;
};

export const getPreviousSrsState = (card: any): State => {
  if ([State.New, State.Learning, State.Review, State.Relearning].includes(card?.state)) return card.state;
  return isNewSrsCard(card) ? State.New : State.Review;
};

/** Anki's "Next day starts at" rollover hour, used for Review-state due dates. */
const ROLLOVER_HOUR = 4;

/** The calendar day a date belongs to for scheduling purposes, with the day starting at ROLLOVER_HOUR local time. */
function studyDayKey(date: Date): string {
  const shifted = new Date(date.getTime());
  if (shifted.getHours() < ROLLOVER_HOUR) shifted.setDate(shifted.getDate() - 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

/**
 * Whether a card's due date has arrived. Review-state cards (interval >= 1 day) are due by
 * calendar day, like Anki, with the day starting at 4 AM local time: a card due today is ready
 * from 4 AM, not only at its exact minute. Learning/Relearning/New cards compare the exact
 * timestamp, since their steps are minutes/hours, not days.
 */
export const isCardDue = (dueDate: Date | null, now: Date, state: State | undefined): boolean => {
  if (!dueDate) return true;
  if (state === State.Review) return studyDayKey(dueDate) <= studyDayKey(now);
  return dueDate.getTime() <= now.getTime();
};

export interface FSRSCard extends LibraryCard {
  // `ts-fsrs` stores this scheduling step on the card; older saved cards do not.
  learning_steps: number;
  word?: string;
  reading?: string;
  sentence?: string;
  source?: string;
  dueDate?: string;
  lastReview?: string;
  interval?: number;
  repetitions?: number;
  ease?: number;
}

export interface FSRSParameters {
  request_retention: number;
  maximum_interval: number;
  enable_fuzz: boolean;
}

/** Thin compatibility layer around the maintained FSRS implementation.
 * Keeps Yoru Reader's existing card shape while using the same scheduler as Anki.
 */
export class FSRS6 {
  private scheduler: ReturnType<typeof createFsrs>;

  constructor(customParams?: Partial<FSRSParameters>) {
    const retention = Number(customParams?.request_retention ?? 0.9);
    const maximumInterval = Number(customParams?.maximum_interval ?? 36500);
    this.scheduler = createFsrs({
      request_retention: Number.isFinite(retention) ? Math.min(0.99, Math.max(0.7, retention)) : 0.9,
      maximum_interval: Number.isFinite(maximumInterval) ? Math.max(1, maximumInterval) : 36500,
      enable_fuzz: customParams?.enable_fuzz ?? true,
      enable_short_term: true,
      learning_steps: ['1m', '10m'],
      relearning_steps: ['10m'],
    });
  }

  public createEmptyCard(now: Date = new Date()): FSRSCard {
    return { ...createLibraryCard(now), state: State.New };
  }

  public repeat(card: FSRSCard, now: Date = new Date()): Record<Rating, FSRSCard> {
    const source = card || this.createEmptyCard(now);
    const compatible = {
      ...createLibraryCard(now),
      ...source,
      due: source.due instanceof Date ? source.due : new Date(source.due || now),
      last_review: source.last_review
        ? (source.last_review instanceof Date ? source.last_review : new Date(source.last_review))
        : undefined,
      state: Number.isInteger(source.state) ? source.state : LibraryState.New,
      learning_steps: Number.isInteger(source.learning_steps) ? source.learning_steps! : 0,
    } as LibraryCard;
    const preview = this.scheduler.repeat(compatible, now);
    const toCard = (rating: LibraryRating): FSRSCard => ({
      ...source,
      ...(preview as any)[rating].card,
      due: new Date((preview as any)[rating].card.due),
      last_review: (preview as any)[rating].card.last_review
        ? new Date((preview as any)[rating].card.last_review)
        : undefined,
    });

    return {
      [Rating.Manual]: { ...source },
      [Rating.Again]: toCard(LibraryRating.Again),
      [Rating.Hard]: toCard(LibraryRating.Hard),
      [Rating.Good]: toCard(LibraryRating.Good),
      [Rating.Easy]: toCard(LibraryRating.Easy),
    };
  }
}
