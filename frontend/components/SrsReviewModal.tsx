import React, { useState, useEffect, useRef } from 'react';
import { X, Volume2, Eye, Clock, Undo2, Ban, Star } from 'lucide-react';
import { db } from '../utils/db';
import { lookupWord } from '../utils/dictionary';
import { updateDiscordReview, clearDiscordPresence } from '../utils/discordRpc';
import { FSRS6, Rating, State, getPreviousSrsState, isNewSrsCard, isCardDue } from '../utils/fsrs';
import { getPitchAccent, getPitchMorae } from '../utils/pitchAccent';
import { playWordAudio, type WordAudioPlayback } from '../utils/wordAudio';
import { syncJitenReview } from '../utils/jitenSync';
import { isPhoneUI } from '../utils/platform';
import { getDeckLimitsLeft, getDeckName, getDeckOptions } from '../utils/srsDeckOptions';

interface PitchAccentGraphProps {
  reading: string;
  position: number;
}

// Beautiful Interactive SVG Pitch Accent Graph
function PitchAccentGraph({ reading, position }: PitchAccentGraphProps) {
  const morae = getPitchMorae(reading);
  if (morae.length === 0) return null;

  const nodeSpacing = 30;
  const height = 50;
  const padding = 12;
  const width = morae.length * nodeSpacing + padding * 2;

  const getLevel = (idx: number) => {
    const moraNum = idx + 1; // 1-based index
    if (position === 0) {
      return moraNum === 1 ? 0 : 1; // Low, then High...
    } else if (position === 1) {
      return moraNum === 1 ? 1 : 0; // High, then Low...
    } else {
      if (moraNum === 1) return 0;
      if (moraNum <= position) return 1;
      return 0;
    }
  };

  const points = morae.map((mora, idx) => {
    const x = padding + idx * nodeSpacing;
    const level = getLevel(idx);
    const y = level === 1 ? 12 : 28; // High node at 12, Low node at 28
    return { x, y, mora, idx, level };
  });

  let dropLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (position > 0 && position <= morae.length) {
    const lastHighPoint = points[position - 1];
    const nextX = lastHighPoint.x + nodeSpacing / 2;
    const dropY = 28; // Drop to low level (28)
    dropLine = { x1: lastHighPoint.x, y1: lastHighPoint.y, x2: nextX, y2: dropY };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', margin: '14px 0' }}>
      <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pitch accent</span>
      <div style={{ overflowX: 'auto', maxWidth: '100%', background: 'rgba(255,255,255,0.01)', borderRadius: '6px', padding: '6px 12px', border: '1px solid rgba(255,255,255,0.03)' }}>
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
          {points.map((pt, idx) => {
            if (idx === 0) return null;
            const prev = points[idx - 1];
            return (
              <line
                key={`line-${idx}`}
                x1={prev.x}
                y1={prev.y}
                x2={pt.x}
                y2={pt.y}
                stroke="#38bdf8"
                strokeWidth="2"
              />
            );
          })}

          {dropLine && (
            <>
              <line
                x1={dropLine.x1}
                y1={dropLine.y1}
                x2={dropLine.x2}
                y2={dropLine.y2}
                stroke="#ef4444"
                strokeWidth="2"
                strokeDasharray="2 2"
              />
              <circle
                cx={dropLine.x2}
                cy={dropLine.y2}
                r="3.5"
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.5"
              />
            </>
          )}

          {points.map((pt) => (
            <g key={`node-${pt.idx}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r="4.5"
                fill={pt.level === 1 ? '#38bdf8' : '#1e293b'}
                stroke="#38bdf8"
                strokeWidth="2"
              />
              <text
                x={pt.x}
                y={height - 4} // Always align text at the bottom
                textAnchor="middle"
                fill="#ffffff"
                style={{ fontSize: '0.72rem', fontFamily: 'var(--font-japanese)', fontWeight: 600 }}
              >
                {pt.mora}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// FSRS 6 scheduler calculations
const calculateSrsIntervals = (card: any, fsrs: FSRS6) => {
  const c = card ? { ...card } : fsrs.createEmptyCard();
  const repeats = fsrs.repeat(c, new Date());
  
  const formatInterval = (days: number, due?: Date) => {
    if (days === 0 && due) {
      const minutes = Math.max(1, Math.round((due.getTime() - Date.now()) / 60000));
      return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
    }
    if (days === 0) return '10m';
    if (days >= 30) {
      return `${Math.round(days / 30)}mo`;
    }
    return `${days}d`;
  };

  return {
    again: formatInterval(repeats[Rating.Again].scheduled_days, repeats[Rating.Again].due),
    hard: formatInterval(repeats[Rating.Hard].scheduled_days, repeats[Rating.Hard].due),
    good: formatInterval(repeats[Rating.Good].scheduled_days, repeats[Rating.Good].due),
    easy: formatInterval(repeats[Rating.Easy].scheduled_days, repeats[Rating.Easy].due),
    repeats,
  };
};

interface SrsReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  filterDeck?: string | null;
}

interface HistoryEntry {
  cardWord: string;
  cardState: any;
  prevWordStatus: string | null;
  prevDueCards: string[];
  prevIndex: number;
  prevSessionCount: number;
  prevStats: { correct: number; incorrect: number };
  prevNewCardsLearned: number;
  prevShowAnswer: boolean;
  prevHistory: any[];
  prevDailyReviews: Record<string, number>;
  prevDailyReviewStats: Record<string, { reviews: number; newWords: string[] }>;
  prevPendingCards: { word: string; dueAt: string }[];
}

export default function SrsReviewModal({ isOpen, onClose, filterDeck = null }: SrsReviewModalProps) {
  const rawSettings = db.getSettings();
  const lang = rawSettings.appLanguage || 'en';
  const showAudioButton = rawSettings.srsShowAudioButton !== false;
  // What the front of the card asks with: the word, the word inside its book sentence, or only its audio.
  // A deck can override the general setting.
  const generalFrontMode: 'word' | 'sentence' | 'audio' = ['sentence', 'audio'].includes(rawSettings.srsCardFront) ? rawSettings.srsCardFront : 'word';

  const fsrsRetentionRate = rawSettings.fsrsRetentionRate !== undefined ? Number(rawSettings.fsrsRetentionRate) : 0.90;
  const fsrsMaxInterval = rawSettings.fsrsMaxInterval !== undefined ? Number(rawSettings.fsrsMaxInterval) : 36500;
  const fsrsEnableFuzz = rawSettings.fsrsEnableFuzz !== undefined ? Boolean(rawSettings.fsrsEnableFuzz) : true;

  const fsrs = React.useMemo(() => {
    return new FSRS6({
      request_retention: fsrsRetentionRate,
      maximum_interval: fsrsMaxInterval,
      enable_fuzz: fsrsEnableFuzz,
    });
  }, [fsrsRetentionRate, fsrsMaxInterval, fsrsEnableFuzz]);

  const [dueCards, setDueCards] = useState<string[]>([]);
  const [pendingCards, setPendingCards] = useState<{ word: string; dueAt: string }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [currentEntry, setCurrentEntry] = useState<any>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionStats, setSessionStats] = useState({ correct: 0, incorrect: 0 });
  const [newCardsLearned, setNewCardsLearned] = useState(0);
  // Keyboard hints (Space, 1-4, Z) only make sense with a keyboard.
  const showKeyHints = !isPhoneUI();
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const wordAudioRef = useRef<WordAudioPlayback | null>(null);

  // Undo History & Display Settings
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>([]);
  const [fontSizeMode, setFontSizeMode] = useState<'S' | 'M' | 'L'>('M');
  const [isTimerVisible, setIsTimerVisible] = useState(true);

  // Timer state
  const [timerSeconds, setTimerSeconds] = useState(0);
  const currentReviewWord = dueCards[0] || null;
  const currentReviewCard = currentReviewWord ? db.getSrsCard(currentReviewWord) : null;
  const currentReviewCardKey = JSON.stringify(currentReviewCard);
  const frontMode = (currentReviewCard && getDeckOptions(rawSettings, getDeckName(currentReviewCard)).cardFront) || generalFrontMode;
  const currentReviewIntervals = React.useMemo(
    () => calculateSrsIntervals(currentReviewCard, fsrs),
    [currentReviewWord, currentReviewCardKey, fsrs],
  );

  // Learning/relearning steps from before this session re-enter the queue once they're due, or
  // immediately once nothing else is queued and they fall within Anki's 20-minute Learn Ahead
  // Limit, instead of showing "zero reviews due" while a card is a few minutes from ready.
  useEffect(() => {
    if (!isOpen || pendingCards.length === 0) return;
    const LEARN_AHEAD_MS = 20 * 60 * 1000;
    const now = Date.now();
    const threshold = dueCards.length === 0 ? now + LEARN_AHEAD_MS : now;

    const ready = pendingCards.filter(card => new Date(card.dueAt).getTime() <= threshold);
    if (ready.length > 0) {
      const readyWords = new Set(ready.map(card => card.word));
      setPendingCards(current => current.filter(card => !readyWords.has(card.word)));
      const returningWords = ready.map(card => card.word).filter(word => !dueCards.includes(word));
      setDueCards(current => [...current, ...returningWords.filter(word => !current.includes(word))]);
      setSessionCount(count => count + returningWords.length);
      setIsFinished(false);
      setShowAnswer(false);
      return;
    }

    // Re-check once the next card becomes due (or, with an empty queue, enters the Ahead window).
    const nextAt = Math.min(...pendingCards.map(card => {
      const dueAt = new Date(card.dueAt).getTime();
      return dueCards.length === 0 ? dueAt - LEARN_AHEAD_MS : dueAt;
    }).filter(Number.isFinite));
    if (!Number.isFinite(nextAt)) return;
    const timer = setTimeout(() => {
      setPendingCards(current => [...current]); // force a re-run of this effect with the current time
    }, Math.max(0, nextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [isOpen, pendingCards, dueCards]);

  const getStudyStreak = (): number => {
    let streak = 0;
    const today = new Date();
    let checkDate = new Date(today);
    
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    const todayKey = `yoru_reader_srs_study_time_${formatDate(checkDate)}`;
    const todayTime = Number(localStorage.getItem(todayKey) || 0);
    
    if (todayTime === 0) {
      checkDate.setDate(checkDate.getDate() - 1);
      const yesterdayKey = `yoru_reader_srs_study_time_${formatDate(checkDate)}`;
      const yesterdayTime = Number(localStorage.getItem(yesterdayKey) || 0);
      if (yesterdayTime === 0) {
        return 0;
      }
    }
    
    while (streak < 365) {
      const key = `yoru_reader_srs_study_time_${formatDate(checkDate)}`;
      const time = Number(localStorage.getItem(key) || 0);
      if (time > 0) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  };

  const getFutureDueCounts = () => {
    const srsData = db.getSrsData();
    const statuses = db.getWordStatuses();
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    let dueWithinHour = 0;
    let dueTomorrow = 0;
    
    Object.entries(srsData).forEach(([word, card]: [string, any]) => {
      if (word.startsWith('_deck_') || !card || ['known', 'ignored', 'blacklisted'].includes(statuses[word])) return;
      if (filterDeck && (card.source || 'Yoru Reader') !== filterDeck) return;
      const dueValue = card.dueDate || card.due;
      if (!dueValue) return;
      const dueDate = new Date(dueValue);
      if (!Number.isFinite(dueDate.getTime())) return;
      if (dueDate > now && dueDate <= oneHourLater) {
        dueWithinHour++;
      } else if (dueDate > now && dueDate <= tomorrow) {
        dueTomorrow++;
      }
    });
    
    return { dueWithinHour, dueTomorrow };
  };

  // Load reviews list
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      initSession();
    } else {
      document.body.style.overflow = '';
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
      }
      wordAudioRef.current?.stop();
      wordAudioRef.current = null;
    }
  }, [isOpen]);

  // Discord Rich Presence Integration
  useEffect(() => {
    if (isOpen) {
      updateDiscordReview(rawSettings);
    } else {
      clearDiscordPresence();
    }
    return () => {
      clearDiscordPresence();
    };
  }, [isOpen]);

  // Session timer effect
  useEffect(() => {
    if (!isOpen || isFinished || dueCards.length === 0) return;
    const interval = setInterval(() => {
      setTimerSeconds(s => {
        const next = s + 1;
        try {
          const now = new Date();
          const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const key = `yoru_reader_srs_study_time_${ymd}`;
          const current = Number(localStorage.getItem(key) || 0);
          localStorage.setItem(key, String(current + 1));
        } catch (e) {
          console.error(e);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, isFinished, dueCards]);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const initSession = () => {
    const statuses = db.getWordStatuses();
    const srsData = db.getSrsData();
    const now = new Date();
    const getCardDue = (card: any): Date | null => {
      for (const value of [card?.due, card?.dueDate]) {
        if (!value) continue;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isFinite(date.getTime())) return date;
      }
      return null;
    };
    const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const todayStr = localDate(now);

    // Include due learning words and imported cards in the current profile.
    let learningWords = Array.from(new Set([
      ...Object.keys(statuses).filter(w => statuses[w] === 'learning'),
      ...Object.keys(srsData).filter(w => !w.startsWith('_deck_') && !['known', 'ignored', 'blacklisted'].includes(statuses[w])),
    ]));
    
    if (filterDeck) {
      learningWords = learningWords.filter(word => {
        const card = srsData[word];
        const deckName = card?.source || 'Yoru Reader';
        return deckName === filterDeck;
      });
    }
    
    // Paused decks stay out of every session.
    const deckLimits = getDeckLimitsLeft(rawSettings, srsData, [], []);
    learningWords = learningWords.filter(word => !deckLimits.isPaused(getDeckName(srsData[word])));

    let due = learningWords.filter(word => {
      const card = srsData[word];
      const dueDate = getCardDue(card);
      return isCardDue(dueDate, now, card?.state);
    });
    const nextDay = now.getTime() + 24 * 60 * 60 * 1000;
    const pendingLearning = learningWords.flatMap(word => {
      const card = srsData[word];
      if (![State.Learning, State.Relearning].includes(card?.state)) return [];
      const dueAt = getCardDue(card);
      return dueAt && dueAt > now && dueAt.getTime() <= nextDay
        ? [{ word, dueAt: dueAt.toISOString() }]
        : [];
    });

    const history = db.getSrsHistory();
    const todayHistory = history.filter((entry: any) => entry.timestamp
      && Number.isFinite(new Date(entry.timestamp).getTime())
      && localDate(new Date(entry.timestamp)) === todayStr);
    const dailyStats = db.getSrsDailyReviewStats()[todayStr];
    const newCardsStudiedToday = new Set([
      ...todayHistory.filter((entry: any) => entry.isNew && entry.word).map((entry: any) => entry.word),
      ...(Array.isArray(dailyStats?.newWords) ? dailyStats.newWords : []),
    ]);
    const reviewsFromHistory = todayHistory.filter((entry: any) => entry.reviewState !== undefined
      ? entry.reviewState === State.Review
      : !entry.isNew).length;
    const reviewsDoneToday = Math.max(reviewsFromHistory, Number(dailyStats?.reviews) || 0);
    const configuredNewLimit = Number(rawSettings.srsNewCardsPerDay ?? 20);
    const newLimit = Number.isFinite(configuredNewLimit) ? Math.max(0, Math.floor(configuredNewLimit)) : 20;
    const newCardsLeftToday = Math.max(0, newLimit - newCardsStudiedToday.size);
    const configuredReviewLimit = Number(rawSettings.srsMaxReviewsPerDay ?? 200);
    const maxReviewsLimit = Number.isFinite(configuredReviewLimit) ? Math.max(0, Math.floor(configuredReviewLimit)) : 200;
    const reviewsLeftToday = Math.max(0, maxReviewsLimit - reviewsDoneToday);
    const perDeck = getDeckLimitsLeft(rawSettings, srsData, todayHistory, newCardsStudiedToday);
    // Keep at most each deck's own daily limit, in queue order.
    const takePerDeck = (words: string[], left: (deck: string) => number) => {
      const remaining: Record<string, number> = {};
      return words.filter(word => {
        const deck = getDeckName(srsData[word]);
        if (remaining[deck] === undefined) remaining[deck] = left(deck);
        if (remaining[deck] <= 0) return false;
        remaining[deck]--;
        return true;
      });
    };

    let finalDue: string[] = [];
    {
      // Anki keeps due learning/relearning steps ahead of reviews and does not
      // count them against the daily review limit.
      const dueLearning = due.filter(word => {
        const state = srsData[word]?.state;
        return state === State.Learning || state === State.Relearning;
      });

      let dueReviews = due.filter(word => {
        const card = srsData[word];
        return !isNewSrsCard(card) && ![State.Learning, State.Relearning].includes(card?.state);
      });

      let dueNew = due.filter(word => {
        const card = srsData[word];
        return isNewSrsCard(card);
      });

      const shuffle = (words: string[]) => {
        const result = [...words];
        for (let i = result.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
      };
      const getDueTimestamp = (word: string) => {
        const date = new Date(srsData[word]?.due || srsData[word]?.dueDate || 0).getTime();
        return Number.isFinite(date) ? date : 0;
      };
      dueLearning.sort((a, b) => getDueTimestamp(a) - getDueTimestamp(b));
      dueReviews.sort((a, b) => getDueTimestamp(a) - getDueTimestamp(b));
      finalDue = [
        ...dueLearning,
        ...takePerDeck(dueReviews, perDeck.reviewsLeft).slice(0, reviewsLeftToday),
        ...shuffle(takePerDeck(shuffle(dueNew), perDeck.newLeft).slice(0, newCardsLeftToday)),
      ];
    }

    const shuffled = [...finalDue];
    setDueCards(shuffled);
    setPendingCards(pendingLearning);
    setCurrentIndex(0);
    setShowAnswer(false);
    setIsFinished(shuffled.length === 0 && pendingLearning.length > 0);
    setSessionCount(shuffled.length);
    setSessionStats({ correct: 0, incorrect: 0 });
    setNewCardsLearned(0);
    setTimerSeconds(0);
    setHistoryStack([]);
  };

  // Load dictionary item
  useEffect(() => {
    if (isOpen && dueCards.length > 0) {
      const word = dueCards[0];
      let active = true;
      setLoadingEntry(true);
      setShowAnswer(false);
      setCurrentEntry(null);
      lookupWord(word)
        .then(entry => {
          if (!active) return;
          setCurrentEntry(entry);
          setLoadingEntry(false);
          if (rawSettings.autoTTS) {
            playWordTts(word, entry?.reading);
          }
        })
        .catch(err => {
          if (!active) return;
          console.error(err);
          setCurrentEntry(null);
          setLoadingEntry(false);
        });
      return () => { active = false; };
    }
    setCurrentEntry(null);
    setLoadingEntry(false);
  }, [isOpen, currentIndex, dueCards, rawSettings.autoTTS]);

  const pushHistory = (word: string, currentCard: any) => {
    const prevCardState = currentCard ? JSON.parse(JSON.stringify(currentCard)) : null;
    setHistoryStack(prev => [...prev, {
      cardWord: word,
      cardState: prevCardState,
      prevWordStatus: db.getWordStatuses()[word] ?? null,
      prevDueCards: [...dueCards],
      prevIndex: currentIndex,
      prevSessionCount: sessionCount,
      prevStats: { ...sessionStats },
      prevNewCardsLearned: newCardsLearned,
      prevShowAnswer: showAnswer,
      prevHistory: db.getSrsHistory(),
      prevDailyReviews: db.getSrsDailyReviews(),
      prevDailyReviewStats: db.getSrsDailyReviewStats(),
      prevPendingCards: [...pendingCards],
    }]);
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const last = historyStack[historyStack.length - 1];
    setHistoryStack(prev => prev.slice(0, -1));

    // Restore status before the card because setting an empty status also removes its SRS card.
    db.setWordStatus(last.cardWord, last.prevWordStatus);
    if (last.cardState) {
      db.saveSrsCard(last.cardWord, last.cardState);
    } else {
      db.saveSrsCard(last.cardWord, null);
    }
    db.restoreSrsHistoryState(last.prevHistory, last.prevDailyReviews, last.prevDailyReviewStats);

    // Restore component states
    setDueCards(last.prevDueCards);
    setPendingCards(last.prevPendingCards);
    setCurrentIndex(last.prevIndex);
    setSessionCount(last.prevSessionCount);
    setSessionStats(last.prevStats);
    setNewCardsLearned(last.prevNewCardsLearned);
    setShowAnswer(last.prevShowAnswer);
    setIsFinished(false);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen || (!dueCards.length && !pendingCards.length && !isFinished)) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      if (key === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (isFinished || dueCards.length === 0) return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!showAnswer) {
          setShowAnswer(true);
        } else {
          submitGrade(3); // Default to Good
        }
      } else if (key === '1') {
        if (showAnswer) submitGrade(1);
      } else if (key === '2') {
        if (showAnswer) submitGrade(2);
      } else if (key === '3') {
        if (showAnswer) submitGrade(3);
      } else if (key === '4') {
        if (showAnswer) submitGrade(4);
      } else if (key === 'b') {
        handleToggleBlacklist();
      } else if (key === 'm') {
        handleToggleMaster();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showAnswer, currentIndex, dueCards, pendingCards, isFinished, historyStack, sessionStats]);

  const playWordTts = async (word: string, reading?: string) => {
    if (!word) return;
    // Card keys can be "word:reading".
    const [term, keyReading] = word.split(':');
    const wordReading = reading || keyReading || '';
    const textToSpeak = wordReading || term;
    
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
    }
    wordAudioRef.current?.stop();
    wordAudioRef.current = null;

    setIsTtsPlaying(true);

    // Android: native recording or device voice (the WebView has no speechSynthesis voices).
    const playback = await playWordAudio(term, wordReading);
    if (playback) {
      wordAudioRef.current = playback;
      playback.ended.then(() => {
        if (wordAudioRef.current !== playback) return;
        wordAudioRef.current = null;
        setIsTtsPlaying(false);
      });
      return;
    }
    
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = 'ja-JP';
      utterance.rate = 0.85;
      utterance.onend = () => setIsTtsPlaying(false);
      utterance.onerror = () => setIsTtsPlaying(false);
      window.speechSynthesis.speak(utterance);
    } else {
      setIsTtsPlaying(false);
    }
  };

  // Listening cards: say the word as soon as the card appears.
  useEffect(() => {
    if (!isOpen || showAnswer || frontMode !== 'audio' || !currentReviewWord || isFinished) return;
    playWordTts(currentReviewWord, db.getSrsCard(currentReviewWord)?.reading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentReviewWord, currentIndex, showAnswer, frontMode, isFinished]);

  const handleToggleBlacklist = () => {
    if (dueCards.length === 0) return;
    const word = dueCards[0];
    const currentCard = db.getSrsCard(word);
    pushHistory(word, currentCard);
    
    db.setWordStatus(word, 'ignored');
    
    setDueCards(prev => prev.slice(1));
    setCurrentIndex(prev => prev + 1);
    if (dueCards.length <= 1) setIsFinished(true);
  };

  const handleToggleMaster = () => {
    if (dueCards.length === 0) return;
    const word = dueCards[0];
    const currentCard = db.getSrsCard(word);
    pushHistory(word, currentCard);
    
    db.setWordStatus(word, 'known');
    db.saveSrsCard(word, null);

    setDueCards(prev => prev.slice(1));
    setCurrentIndex(prev => prev + 1);
    if (dueCards.length <= 1) setIsFinished(true);
  };

  const submitGrade = (grade: number) => {
    if (dueCards.length === 0) return;
    const word = dueCards[0];
    const currentCard = db.getSrsCard(word);
    pushHistory(word, currentCard);

    const previousState = getPreviousSrsState(currentCard);
    const isNew = previousState === State.New;
    if (isNew) {
      setNewCardsLearned(prev => prev + 1);
    }

    const intervals = word === currentReviewWord
      ? currentReviewIntervals
      : calculateSrsIntervals(currentCard, fsrs);
    const updatedCard = { 
      ...currentCard,
      ...(intervals.repeats as any)[grade] 
    };

    // Ensure all metadata fields are preserved
    if (!updatedCard.word) updatedCard.word = word;
    if (currentCard) {
      if (!updatedCard.reading) updatedCard.reading = currentCard.reading || '';
      if (!updatedCard.sentence) updatedCard.sentence = currentCard.sentence || '';
      if (!updatedCard.source) updatedCard.source = currentCard.source || filterDeck || '';
    } else {
      updatedCard.source = filterDeck || '';
    }

    if (grade === 1) {
      setSessionStats(s => ({ ...s, incorrect: s.incorrect + 1 }));
    } else {
      setSessionStats(s => ({ ...s, correct: s.correct + 1 }));
    }

    db.saveSrsCard(word, updatedCard);
    db.addSrsHistory(word, grade, updatedCard.scheduled_days ?? updatedCard.interval ?? 0, updatedCard.source || '', isNew, previousState);
    syncJitenReview(word, updatedCard.reading || '', grade);

    const isLearningStep = [State.Learning, State.Relearning].includes(updatedCard.state)
      && new Date(updatedCard.due).getTime() > Date.now();
    if (isLearningStep) {
      // Like Anki: a card still in a learning/relearning step stays in the active session
      // queue (moved to the end) instead of being pulled out to wait for its real due time.
      // It only leaves dueCards for good once it graduates (Good/Easy on the last step).
      setDueCards(prev => [...prev.slice(1), word]);
      setCurrentIndex(prev => prev + 1);
      setSessionCount(prev => prev + 1);
      setShowAnswer(false);
    } else {
      setDueCards(prev => prev.slice(1));
      setCurrentIndex(prev => prev + 1);
      if (dueCards.length <= 1) setIsFinished(true);
      setShowAnswer(false);
    }
  };

  if (!isOpen) return null;

  const currentWord = currentReviewWord;
  const displayWord = currentWord ? (currentWord.includes(':') ? currentWord.split(':')[0] : currentWord) : '';
  const srsCardData = currentReviewCard;
  const intervals = currentReviewIntervals;

  let newCardsCount = 0;
  let learningCardsCount = 0;
  dueCards.forEach(w => {
    const card = db.getSrsCard(w);
    if (isNewSrsCard(card)) newCardsCount++;
    else if ([State.Learning, State.Relearning].includes(card?.state)) learningCardsCount++;
  });
  const reviewCardsCount = dueCards.length - newCardsCount - learningCardsCount;
  const currentCardKind = !srsCardData || isNewSrsCard(srsCardData)
    ? 'new'
    : ([State.Learning, State.Relearning].includes(srsCardData.state) ? 'learn' : 'review');
  const currentCardKindLabel = lang === 'es'
    ? { new: 'Nueva', learn: 'Aprendiendo', review: 'Repaso' }[currentCardKind]
    : { new: 'New', learn: 'Learning', review: 'Review' }[currentCardKind];
  const sentenceParts = (() => {
    const sentence = srsCardData?.sentence || '';
    const at = displayWord ? sentence.indexOf(displayWord) : -1;
    return at < 0 ? null : [sentence.slice(0, at), displayWord, sentence.slice(at + displayWord.length)];
  })();

  return (
    <div className="srs-rv">
      
      {/* Top bar: exit, queue counts, timer */}
      <div className="srs-rv-top">
        <button type="button" className="srs-rv-icon-btn" onClick={onClose} aria-label={lang === 'es' ? 'Salir del repaso' : 'Exit review'} title={lang === 'es' ? 'Salir' : 'Exit'}>
          <X size={18} />
        </button>
        <div className="srs-rv-counts" aria-label={lang === 'es' ? 'Tarjetas pendientes' : 'Cards left'}>
          <span className="srs-pill is-new" title={lang === 'es' ? 'Nuevas' : 'New'}>{newCardsCount}</span>
          <span className="srs-pill is-learn" title={lang === 'es' ? 'Aprendiendo' : 'Learning'}>{learningCardsCount}</span>
          <span className="srs-pill is-review" title={lang === 'es' ? 'Repaso' : 'Review'}>{reviewCardsCount}</span>
        </div>
        <button
          type="button"
          className={`srs-rv-icon-btn${isTimerVisible ? ' is-active' : ''}`}
          onClick={() => setIsTimerVisible(prev => !prev)}
          aria-label={lang === 'es' ? 'Mostrar/Ocultar cronómetro' : 'Show/Hide timer'}
          title={lang === 'es' ? 'Mostrar/Ocultar cronómetro' : 'Show/Hide timer'}
        >
          <Clock size={18} />
        </button>
      </div>

      <div className="srs-rv-progress">
        <div className="srs-rv-progress-track">
          <div className="srs-rv-progress-fill" style={{ width: `${sessionCount > 0 ? Math.min(100, (currentIndex / sessionCount) * 100) : 0}%` }} />
        </div>
        <div className="srs-rv-progress-meta">
          <span>
            {dueCards.length > 0 ? Math.min(currentIndex + 1, sessionCount) : currentIndex} {lang === 'es' ? 'de' : 'of'} {sessionCount}
            {isTimerVisible && <> · {formatTimer(timerSeconds)}</>}
          </span>
          {srsCardData?.source && !isFinished && dueCards.length > 0 && <span className="srs-rv-source">{srsCardData.source}</span>}
        </div>
      </div>

      {/* Content Area */}
      <div className="srs-rv-content">
        
        {dueCards.length === 0 && !isFinished ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', maxWidth: '450px', width: '100%' }}>
            <div style={{ fontSize: '4.5rem', marginBottom: '24px' }}>🏆</div>
            <h3 style={{ fontSize: '1.6rem', color: 'var(--text-main)', marginBottom: '10px', fontWeight: 800 }}>
              {lang === 'es' ? '¡Estás al día!' : 'Zero reviews due!'}
            </h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', textAlign: 'center', color: 'var(--text-muted)', margin: '0 0 32px 0' }}>
              {lang === 'es' 
                ? 'No tienes palabras pendientes de repaso en este mazo en este momento. ¡Buen trabajo!' 
                : 'You have no words due for review in this deck right now. Great job!'}
            </p>
            <button 
              type="button" 
              onClick={onClose} 
              style={{ padding: '12px 36px', background: 'var(--primary)', color: 'var(--srs-on-primary)', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
            >
              {lang === 'es' ? 'Volver' : 'Go Back'}
            </button>
          </div>
        ) : isFinished ? (() => {
          const totalReviews = sessionStats.correct + sessionStats.incorrect;
          const passRate = totalReviews > 0 ? Math.round((sessionStats.correct / totalReviews) * 100) : 100;
          const streak = getStudyStreak();
          const streakText = lang === 'es'
            ? (streak > 0 ? `¡Racha de ${streak} días — un gran comienzo!` : '¡Buen comienzo! Sigue repasando a diario.')
            : (streak > 0 ? `${streak} day streak — great start!` : 'Great start! Keep reviewing daily.');
          
          const formatTimeSpent = (sec: number) => {
            if (sec < 60) return `${sec}s`;
            const mins = Math.floor(sec / 60);
            const secs = sec % 60;
            return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
          };

          const { dueWithinHour, dueTomorrow } = getFutureDueCounts();
          const correctLabel = lang === 'es' ? 'Correctas' : 'Good';
          const incorrectLabel = lang === 'es' ? 'Repetir' : 'Again';
          const distributionText = `${sessionStats.correct} ${correctLabel} · ${sessionStats.incorrect} ${incorrectLabel}`;
          const queueText = lang === 'es'
            ? `${dueWithinHour} pendientes en la próxima hora · ${dueTomorrow} pendientes mañana`
            : `${dueWithinHour} due within the hour · ${dueTomorrow} due tomorrow`;

          return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', maxWidth: '450px', width: '100%' }}>
              <div style={{ fontSize: '4.5rem', marginBottom: '24px' }}>🎉</div>
              <h3 style={{ fontSize: '1.6rem', color: 'var(--text-main)', marginBottom: '4px', fontWeight: 800 }}>
                {lang === 'es' ? '¡Sesión Completada!' : 'Session Completed!'}
              </h3>
              <p style={{ fontSize: '0.9rem', marginBottom: '28px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 500 }}>
                {streakText}
              </p>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '16px',
                width: '100%',
                marginBottom: '24px'
              }}>
                {/* Reviews */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Repasos' : 'Reviews'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-main)', marginTop: '6px' }}>
                    {totalReviews}
                  </div>
                </div>

                {/* New Cards */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Tarjetas Nuevas' : 'New Cards'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--srs-new)', marginTop: '6px' }}>
                    {newCardsLearned}
                  </div>
                </div>

                {/* Pass Rate */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Aciertos' : 'Pass Rate'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--srs-review)', marginTop: '6px' }}>
                    {passRate}%
                  </div>
                </div>

                {/* Time Spent */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Tiempo' : 'Time Spent'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--srs-learn)', marginTop: '6px' }}>
                    {formatTimeSpent(timerSeconds)}
                  </div>
                </div>
              </div>

              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', marginBottom: '28px', display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 500 }}>
                <span>{distributionText}</span>
                {pendingCards.length > 0 && (
                  <span>{lang === 'es' ? `${pendingCards.length} paso${pendingCards.length === 1 ? '' : 's'} de aprendizaje se guardaron para más tarde.` : `${pendingCards.length} learning step${pendingCards.length === 1 ? '' : 's'} scheduled for later.`}</span>
                )}
                <span style={{ opacity: 0.7 }}>{queueText}</span>
              </div>

              <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                <button 
                  type="button" 
                  onClick={initSession} 
                  style={{ flex: 1, padding: '12px 24px', background: 'var(--surface-soft)', color: 'var(--text-main)', border: '1px solid var(--border-light)', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-soft)'}
                >
                  {lang === 'es' ? 'Estudiar más' : 'Study More'}
                </button>
                <button 
                  type="button" 
                  onClick={onClose} 
                  style={{ flex: 1, padding: '12px 28px', background: 'var(--primary)', color: 'var(--srs-on-primary)', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                >
                  {lang === 'es' ? 'Listo' : 'Done'}
                </button>
              </div>
            </div>
          );
        })() : (
          <div className="srs-rv-stage">

            <div className={`srs-rv-card${showAnswer ? ' is-answer' : ''}`} onClick={() => { if (!showAnswer && !loadingEntry) setShowAnswer(true); }}>
              <span className={`srs-rv-kind is-${currentCardKind}`}>{currentCardKindLabel}</span>

              {loadingEntry ? (
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <div className="spinner" style={{ width: '36px', height: '36px' }}></div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: showAnswer ? 'flex-start' : 'center' }}>
                  {/* Spelling Area */}
                  {(showAnswer || frontMode === 'word' || (frontMode === 'sentence' && !srsCardData?.sentence)) && (
                  <div style={{ textAlign: 'center', marginBottom: showAnswer ? '20px' : '0' }}>
                    {showAnswer && currentEntry?.reading && (
                      <div style={{ 
                        fontSize: fontSizeMode === 'S' ? '1rem' : (fontSizeMode === 'M' ? '1.3rem' : '1.7rem'), 
                        color: 'var(--text-muted)', 
                        fontWeight: 500, 
                        marginBottom: '8px', 
                        fontFamily: 'var(--font-japanese)' 
                      }}>
                        {currentEntry.reading}
                      </div>
                    )}
                    <h2 style={{
                      // Fit the word on one line: cap the size by the width left for each character
                      // (viewport minus card padding and the TTS button).
                      fontSize: `min(${showAnswer
                        ? (fontSizeMode === 'S' ? '2.2rem' : (fontSizeMode === 'M' ? '2.8rem' : '3.6rem'))
                        : (fontSizeMode === 'S' ? '3.2rem' : (fontSizeMode === 'M' ? '4.2rem' : '5.4rem'))}, calc((min(100vw, 720px) - 150px) / ${Math.max(1, Array.from(displayWord || '').length)}))`,
                      fontWeight: 800,
                      color: 'var(--text-main)',
                      letterSpacing: '0.01em',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      margin: 0,
                      fontFamily: 'var(--font-japanese)',
                      justifyContent: 'center',
                      width: '100%',
                      lineHeight: 1.2
                    }}>
                      <span style={{ whiteSpace: 'nowrap', minWidth: 0 }}>{displayWord}</span>
                      {showAudioButton && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); playWordTts(displayWord, currentEntry?.reading); }}
                        aria-label={lang === 'es' ? 'Escuchar la palabra' : 'Play word audio'}
                        style={{ flexShrink: 0, background: 'var(--surface-soft)', border: '1px solid var(--border-light)', borderRadius: '50%', width: '38px', height: '38px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: 'var(--srs-new)', transition: 'all 0.15s' }}
                      >
                        <Volume2 size={18} />
                      </button>
                      )}
                    </h2>
                  </div>
                  )}

                  {showAnswer && <div style={{ borderBottom: '1px solid var(--border-light)', width: '100%', marginBottom: '20px', marginTop: '10px' }}></div>}

                  {showAnswer ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'left' }}>
                      {currentEntry?.partsOfSpeech && currentEntry.partsOfSpeech.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {currentEntry.partsOfSpeech.filter((pos: string) => pos !== 'Yomitan').map((pos: string, i: number) => (
                            <span key={i} style={{ background: 'var(--yoru-gold-soft, rgba(242, 200, 102, 0.13))', border: 'none', color: 'var(--primary)', fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                              {pos}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ 
                        color: 'var(--text-main)', 
                        fontSize: fontSizeMode === 'S' ? '0.85rem' : (fontSizeMode === 'M' ? '0.98rem' : '1.15rem'), 
                        lineHeight: '1.6' 
                      }}>
                        {currentEntry?.definitions && currentEntry.definitions.length > 0 ? (
                          <ol style={{ paddingLeft: '20px', margin: 0 }}>
                            {currentEntry.definitions.slice(0, 5).map((def: any, i: number) => {
                              const text = typeof def === 'string' ? def : (def.glossary || '');
                              return (
                                <li key={i} style={{ marginBottom: '6px', fontWeight: 500 }}>
                                  {text}
                                </li>
                              );
                            })}
                          </ol>
                        ) : (
                          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                            {lang === 'es' ? 'Sin traducción' : 'No translation available'}
                          </p>
                        )}
                      </div>

                      {(() => {
                        const accent = getPitchAccent(currentEntry?.pitches, srsCardData?.reading || currentEntry?.reading || displayWord);
                        return accent ? <PitchAccentGraph reading={accent.reading || displayWord} position={accent.position} /> : null;
                      })()}

                      {/* Context sentence */}
                      {srsCardData?.sentence && (
                        <div style={{ 
                          background: 'var(--surface-soft)', 
                          border: '1px solid var(--border-light)', 
                          borderRadius: '10px', 
                          padding: '14px 18px', 
                          marginTop: '8px', 
                          direction: 'ltr', 
                          textAlign: 'left' 
                        }}>
                          <p style={{ 
                            margin: 0, 
                            fontSize: fontSizeMode === 'S' ? '0.88rem' : (fontSizeMode === 'M' ? '1.02rem' : '1.18rem'), 
                            color: 'var(--text-main)', 
                            fontFamily: 'var(--font-japanese)', 
                            lineHeight: '1.6' 
                          }}>
                            {sentenceParts ? <>{sentenceParts[0]}<mark className="srs-rv-mark">{sentenceParts[1]}</mark>{sentenceParts[2]}</> : srsCardData.sentence}
                          </p>
                          {srsCardData.source && (
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '6px', fontWeight: 600 }}>
                              {srsCardData.source}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    frontMode === 'audio' ? (
                      <div className="srs-rv-listen">
                        <button
                          type="button"
                          className={`srs-rv-listen-btn${isTtsPlaying ? ' is-playing' : ''}`}
                          onClick={(e) => { e.stopPropagation(); playWordTts(displayWord, srsCardData?.reading); }}
                          aria-label={lang === 'es' ? 'Escuchar otra vez' : 'Play again'}
                        >
                          <Volume2 size={34} />
                        </button>
                        <span>{lang === 'es' ? 'Escucha la palabra y recuerda qué significa' : 'Listen to the word and recall its meaning'}</span>
                      </div>
                    ) : frontMode === 'sentence' && srsCardData?.sentence ? (
                      <div className="srs-rv-listen">
                        <p className="srs-rv-front-sentence is-main">
                          {sentenceParts ? <>{sentenceParts[0]}<mark className="srs-rv-mark">{sentenceParts[1]}</mark>{sentenceParts[2]}</> : srsCardData.sentence}
                        </p>
                        {showAudioButton && (
                          <button
                            type="button"
                            className="srs-rv-icon-btn"
                            onClick={(e) => { e.stopPropagation(); playWordTts(displayWord, srsCardData?.reading); }}
                            aria-label={lang === 'es' ? 'Escuchar la palabra' : 'Play word audio'}
                          >
                            <Volume2 size={18} />
                          </button>
                        )}
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions Area */}
            {showAnswer ? (
              <div className="srs-rv-actions">
                <div className="srs-rv-grades">
                  {([
                    [1, 'again', lang === 'es' ? 'Otra vez' : 'Again', intervals.again],
                    [2, 'hard', lang === 'es' ? 'Difícil' : 'Hard', intervals.hard],
                    [3, 'good', lang === 'es' ? 'Bien' : 'Good', intervals.good],
                    [4, 'easy', lang === 'es' ? 'Fácil' : 'Easy', intervals.easy],
                  ] as const).map(([grade, key, label, interval]) => (
                    <button key={key} type="button" className={`srs-rv-grade is-${key}`} onClick={() => submitGrade(grade)}>
                      <span className="srs-rv-grade-label">{label}</span>
                      <span className="srs-rv-grade-interval">{interval}</span>
                      {showKeyHints && <span className="srs-rv-key">{grade}</span>}
                    </button>
                  ))}
                </div>

                <div className="srs-rv-utility">
                  <button type="button" onClick={handleUndo} disabled={historyStack.length === 0}>
                    <Undo2 size={14} />
                    <span>{lang === 'es' ? 'Deshacer' : 'Undo'}</span>
                    {showKeyHints && <span className="srs-rv-key">Z</span>}
                  </button>
                  <button type="button" onClick={handleToggleMaster}>
                    <Star size={14} />
                    <span>{lang === 'es' ? 'Ya la sé' : 'Mastered'}</span>
                    {showKeyHints && <span className="srs-rv-key">M</span>}
                  </button>
                  <button type="button" onClick={handleToggleBlacklist}>
                    <Ban size={14} />
                    <span>{lang === 'es' ? 'Ignorar' : 'Blacklist'}</span>
                    {showKeyHints && <span className="srs-rv-key">B</span>}
                  </button>
                </div>
              </div>
            ) : (
              <div className="srs-rv-actions">
                <button type="button" className="srs-rv-show" onClick={() => setShowAnswer(true)}>
                  <span>{lang === 'es' ? 'Mostrar respuesta' : 'Show answer'}</span>
                  {showKeyHints && <span className="srs-rv-key">{lang === 'es' ? 'Espacio' : 'Space'}</span>}
                </button>
                <div className="srs-rv-utility">
                  <button type="button" onClick={handleUndo} disabled={historyStack.length === 0}>
                    <Undo2 size={14} />
                    <span>{lang === 'es' ? 'Deshacer' : 'Undo'}</span>
                    {showKeyHints && <span className="srs-rv-key">Z</span>}
                  </button>
                </div>
              </div>
            )}

            {/* Text size */}
            <div className="srs-rv-footer">
              <div className="srs-rv-size" role="group" aria-label={lang === 'es' ? 'Tamaño del texto' : 'Text size'}>
                {(['S', 'M', 'L'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={fontSizeMode === mode ? 'is-active' : ''}
                    onClick={() => setFontSizeMode(mode)}
                    aria-pressed={fontSizeMode === mode}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>

    </div>
  );
}
