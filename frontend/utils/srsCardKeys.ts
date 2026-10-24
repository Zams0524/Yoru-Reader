/**
 * SRS cards are stored by key in `srsData`. Most keys are the word itself, which is what the
 * reader looks up. A key can also carry more after a colon (`word:reading`, the Yomitan format, or
 * `word:reading:<anki card id>` for an Anki card whose word already has another card), so that one
 * word can have several cards, like in Anki. Everything before the first colon is the word.
 */
export const srsWordOfKey = (key: string): string => (key.includes(':') ? key.split(':')[0] : key);

const INACTIVE_STATUSES = ['known', 'ignored', 'blacklisted'];

/** Whether a card stays out of reviews and due counts: suspended in Anki, or its word is known/ignored. */
export function isSrsCardInactive(key: string, card: any, statuses: Record<string, string>): boolean {
  if (card?.suspended) return true;
  return INACTIVE_STATUSES.includes(statuses[key]) || INACTIVE_STATUSES.includes(statuses[srsWordOfKey(key)]);
}
