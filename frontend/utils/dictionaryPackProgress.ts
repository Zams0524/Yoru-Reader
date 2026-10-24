// Progress of the recommended-dictionaries install, kept apart from yomitanDB so the app-wide
// toast can follow it without loading the dictionary code.

export interface PackProgress {
  running: boolean;
  /** 1-based position of the item being installed, out of `total`. */
  step: number;
  total: number;
  label: string;
  percent: number;
  done: boolean;
  error: string;
}

export const IDLE: PackProgress = { running: false, step: 0, total: 0, label: '', percent: 0, done: false, error: '' };
let progress: PackProgress = IDLE;
const listeners = new Set<(progress: PackProgress) => void>();

export function publish(next: Partial<PackProgress>) {
  progress = { ...progress, ...next };
  listeners.forEach(listener => listener(progress));
}

export function getPackProgress(): PackProgress {
  return progress;
}

export function subscribePackProgress(listener: (progress: PackProgress) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Hide the finished/failed state (the toast calls this after showing it). */
export function dismissPackProgress() {
  if (!progress.running) publish(IDLE);
}

