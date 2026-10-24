// How common a word is, from the first installed frequency list (the user's order).
// Ranks are positions in the list: 1 is the most used word.

export interface FrequencyBadge {
  dictionary: string;
  rank: number;
  display: string;
  stars: 1 | 2 | 3 | 4 | 5;
  label: string;
}

const LIMITS: [number, FrequencyBadge['stars']][] = [[1500, 5], [5000, 4], [12000, 3], [25000, 2]];
const LABELS: Record<'es' | 'en', Record<FrequencyBadge['stars'], string>> = {
  es: { 5: 'Muy común', 4: 'Común', 3: 'Frecuente', 2: 'Poco común', 1: 'Rara' },
  en: { 5: 'Very common', 4: 'Common', 3: 'Frequent', 2: 'Uncommon', 1: 'Rare' },
};

function rankOf(frequency: any): number {
  if (typeof frequency?.value === 'number' && frequency.value > 0) return frequency.value;
  const text = String(frequency?.displayValue ?? frequency?.value ?? '');
  const parsed = parseInt(text.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

/** One badge per frequency list, best (lowest) rank of each, in the order the lists come in. */
export function frequencyBadges(frequencies: any[] | undefined, lang: string): FrequencyBadge[] {
  const best = new Map<string, number>();
  for (const frequency of frequencies || []) {
    const rank = rankOf(frequency);
    if (!Number.isFinite(rank)) continue;
    const current = best.get(frequency.dictionary);
    if (current === undefined || rank < current) best.set(frequency.dictionary, rank);
  }
  const labels = LABELS[lang === 'es' ? 'es' : 'en'];
  return [...best.entries()].map(([dictionary, rank]) => {
    const stars = LIMITS.find(([limit]) => rank <= limit)?.[1] ?? 1;
    return { dictionary, rank, display: `#${rank.toLocaleString()}`, stars, label: labels[stars] };
  });
}

/** Short name of a frequency list for the popup ("Novels", "Netflix"…). */
export function frequencyListName(title: string): string {
  return title.replace(/\s*(frequency|frequencies|frecuencias?|freq)\b/ig, '').replace(/\s*\[.*\]$/, '').trim() || title;
}
