export function getPitchMorae(reading: string): string[] {
  if (!reading) return [];

  // Jiten/Yomitan may include kana in brackets after each kanji; graph only the reading.
  const bracketReadings = Array.from(reading.matchAll(/[\[［]([^\]］]+)[\]］]/g), match => match[1]).join('');
  const source = (bracketReadings || reading)
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s.・]/g, '');
  const kana = source.replace(/[^ぁ-ゖー]/g, '');
  const morae: string[] = [];
  const smallKana = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);

  for (const char of kana) {
    if (smallKana.has(char) && morae.length > 0) morae[morae.length - 1] += char;
    else morae.push(char);
  }
  return morae;
}

export function getPitchAccent(pitchEntries: any, preferredReading = ''): { reading: string; position: number } | null {
  if (!Array.isArray(pitchEntries) || pitchEntries.length === 0) return null;
  const normalize = (value: string) => getPitchMorae(value).join('');
  const preferred = normalize(preferredReading);
  const entry = (preferred && pitchEntries.find(item => normalize(item?.reading || '') === preferred)) || pitchEntries[0];
  const pitch = Array.isArray(entry?.pitches) ? entry.pitches[0] : null;
  if (!pitch) return null;
  const numericPosition = Number(pitch.position);
  return {
    reading: entry.reading || preferredReading,
    position: Number.isFinite(numericPosition) ? Math.max(0, Math.floor(numericPosition)) : 0,
  };
}
