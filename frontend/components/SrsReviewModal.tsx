import React, { useState, useEffect, useRef } from 'react';
import { X, Volume2, Eye, Clock, LogOut, Menu, Undo2, Ban, Star, Settings, ChevronDown, Columns } from 'lucide-react';
import { db } from '../utils/db';
import { lookupWord } from '../utils/dictionary';
import { updateDiscordReview, clearDiscordPresence } from '../utils/discordRpc';
import { FSRS6, Rating, State, getPreviousSrsState, isNewSrsCard } from '../utils/fsrs';
import { getPitchAccent, getPitchMorae } from '../utils/pitchAccent';
import { playWordAudio, type WordAudioPlayback } from '../utils/wordAudio';

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
  const currentReviewIntervals = React.useMemo(
    () => calculateSrsIntervals(currentReviewCard, fsrs),
    [currentReviewWord, currentReviewCardKey, fsrs],
  );

  // Learning/relearning steps re-enter the queue only when their scheduled time arrives.
  useEffect(() => {
    if (!isOpen || pendingCards.length === 0) return;
    const nextDueAt = Math.min(...pendingCards.map(card => new Date(card.dueAt).getTime()).filter(Number.isFinite));
    if (!Number.isFinite(nextDueAt)) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      const ready = pendingCards.filter(card => new Date(card.dueAt).getTime() <= now);
      if (ready.length === 0) return;
      const readyWords = new Set(ready.map(card => card.word));
      setPendingCards(current => current.filter(card => !readyWords.has(card.word)));
      const returningWords = ready.map(card => card.word).filter(word => !dueCards.includes(word));
      setDueCards(current => [...current, ...returningWords.filter(word => !current.includes(word))]);
      setSessionCount(count => count + returningWords.length);
      setIsFinished(false);
      setShowAnswer(false);
    }, Math.max(0, nextDueAt - Date.now()));
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
    
    let due = learningWords.filter(word => {
      const card = srsData[word];
      const dueDate = getCardDue(card);
      return !dueDate || dueDate <= now;
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
        ...dueReviews.slice(0, reviewsLeftToday),
        ...shuffle(dueNew.slice(0, newCardsLeftToday)),
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

    const isLearningStep = [State.Learning, State.Relearning].includes(updatedCard.state)
      && new Date(updatedCard.due).getTime() > Date.now();
    if (isLearningStep) {
      const dueAt = updatedCard.due instanceof Date ? updatedCard.due.toISOString() : new Date(updatedCard.due).toISOString();
      setDueCards(prev => prev.slice(1));
      setPendingCards(prev => [...prev.filter(card => card.word !== word), { word, dueAt }]);
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

  const newCardsCount = dueCards.filter(w => {
    const card = db.getSrsCard(w);
    return isNewSrsCard(card);
  }).length;
  const reviewCardsCount = dueCards.length - newCardsCount;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000000',
      zIndex: 1500,
      display: 'flex',
      flexDirection: 'column',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      
      {/* Native Top Navigation Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(14px + var(--yoru-safe-top, 0px)) 24px 14px', background: '#000000', borderBottom: '1px solid #18181b', position: 'relative' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ background: '#2563eb', color: '#ffffff', fontSize: '0.74rem', padding: '4px 10px', borderRadius: '6px', fontWeight: 800 }}>
            {newCardsCount} new
          </span>
          <span style={{ background: '#16a34a', color: '#ffffff', fontSize: '0.74rem', padding: '4px 10px', borderRadius: '6px', fontWeight: 800 }}>
            {reviewCardsCount} review
          </span>
        </div>
 
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#ffffff', letterSpacing: '0.02em' }}>
            <span style={{ color: '#ffffff' }}>{dueCards.length > 0 ? Math.min(currentIndex + 1, sessionCount) : currentIndex}</span>
            <span style={{ color: '#71717a', margin: '0 4px' }}>/</span>
            <span style={{ color: '#71717a' }}>{sessionCount}</span>
          </div>
          {isTimerVisible && (
            <div style={{ fontSize: '0.74rem', color: '#71717a', fontWeight: 700, marginTop: '2px' }}>
              {formatTimer(timerSeconds)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setIsTimerVisible(prev => !prev)}
            style={{ background: 'transparent', border: '1px solid #27272a', borderRadius: '8px', color: '#a1a1aa', width: '36px', height: '36px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
            title={lang === 'es' ? 'Mostrar/Ocultar cronómetro' : 'Show/Hide timer'}
          >
            <Clock size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid #27272a', borderRadius: '8px', color: '#ef4444', width: '36px', height: '36px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
            title={lang === 'es' ? 'Salir' : 'Exit'}
          >
            <LogOut size={16} />
          </button>
          <button
            type="button"
            style={{ background: 'transparent', border: '1px solid #27272a', borderRadius: '8px', color: '#a1a1aa', width: '36px', height: '36px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
          >
            <Menu size={16} />
          </button>
        </div>
      </div>

      {/* Red Progress Bar */}
      <div style={{ width: '100%', height: '4px', background: '#18181b', position: 'relative' }}>
        <div style={{ 
          width: `${sessionCount > 0 ? Math.min(100, (currentIndex / sessionCount) * 100) : 0}%`, 
          height: '100%', 
          background: '#ef4444', 
          transition: 'width 0.2s ease-in-out' 
        }} />
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, minHeight: 0, padding: '24px 24px calc(24px + var(--yoru-safe-bottom, 0px))', display: 'flex', flexDirection: 'column', background: '#000000', overflowY: 'auto', justifyContent: 'center', alignItems: 'center' }}>
        
        {dueCards.length === 0 && !isFinished ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#71717a', maxWidth: '450px', width: '100%' }}>
            <div style={{ fontSize: '4.5rem', marginBottom: '24px' }}>🏆</div>
            <h3 style={{ fontSize: '1.6rem', color: '#ffffff', marginBottom: '10px', fontWeight: 800 }}>
              {lang === 'es' ? '¡Estás al día!' : 'Zero reviews due!'}
            </h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', textAlign: 'center', color: '#a1a1aa', margin: '0 0 32px 0' }}>
              {lang === 'es' 
                ? 'No tienes palabras pendientes de repaso en este mazo en este momento. ¡Buen trabajo!' 
                : 'You have no words due for review in this deck right now. Great job!'}
            </p>
            <button 
              type="button" 
              onClick={onClose} 
              style={{ padding: '12px 36px', background: 'var(--primary)', color: '#000000', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
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
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#71717a', maxWidth: '450px', width: '100%' }}>
              <div style={{ fontSize: '4.5rem', marginBottom: '24px' }}>🎉</div>
              <h3 style={{ fontSize: '1.6rem', color: '#ffffff', marginBottom: '4px', fontWeight: 800 }}>
                {lang === 'es' ? '¡Sesión Completada!' : 'Session Completed!'}
              </h3>
              <p style={{ fontSize: '0.9rem', marginBottom: '28px', textAlign: 'center', color: '#a1a1aa', fontWeight: 500 }}>
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
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: '#a1a1aa', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Repasos' : 'Reviews'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ffffff', marginTop: '6px' }}>
                    {totalReviews}
                  </div>
                </div>

                {/* New Cards */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: '#a1a1aa', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Tarjetas Nuevas' : 'New Cards'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#60a5fa', marginTop: '6px' }}>
                    {newCardsLearned}
                  </div>
                </div>

                {/* Pass Rate */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: '#a1a1aa', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Aciertos' : 'Pass Rate'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#4ade80', marginTop: '6px' }}>
                    {passRate}%
                  </div>
                </div>

                {/* Time Spent */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: '#a1a1aa', letterSpacing: '0.04em' }}>
                    {lang === 'es' ? 'Tiempo' : 'Time Spent'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#fb923c', marginTop: '6px' }}>
                    {formatTimeSpent(timerSeconds)}
                  </div>
                </div>
              </div>

              <div style={{ color: '#71717a', fontSize: '0.78rem', textAlign: 'center', marginBottom: '28px', display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 500 }}>
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
                  style={{ flex: 1, padding: '12px 24px', background: 'rgba(255,255,255,0.04)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                >
                  {lang === 'es' ? 'Estudiar más' : 'Study More'}
                </button>
                <button 
                  type="button" 
                  onClick={onClose} 
                  style={{ flex: 1, padding: '12px 28px', background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                >
                  {lang === 'es' ? 'Listo' : 'Done'}
                </button>
              </div>
            </div>
          );
        })() : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: '720px', margin: '0 auto' }}>
            
            {/* Card Container */}
            <div style={{ 
              background: '#09090b', 
              border: '1px solid #27272a', 
              borderRadius: '16px',
              padding: 'clamp(18px, 5vw, 30px)',
              flex: 1,
              display: 'flex', 
              flexDirection: 'column', 
              position: 'relative', 
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              overflowY: 'auto'
            }}>
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', color: '#71717a', fontSize: '0.74rem' }}>
                <span style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1rem' }}>Review</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>#{currentIndex + 1}</span>
                  <span style={{ cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.02)' }}>•••</span>
                </div>
              </div>

              {loadingEntry ? (
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <div className="spinner" style={{ width: '36px', height: '36px' }}></div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: showAnswer ? 'flex-start' : 'center' }}>
                  {/* Spelling Area */}
                  <div style={{ textAlign: 'center', marginBottom: showAnswer ? '20px' : '0' }}>
                    {showAnswer && currentEntry?.reading && (
                      <div style={{ 
                        fontSize: fontSizeMode === 'S' ? '1rem' : (fontSizeMode === 'M' ? '1.3rem' : '1.7rem'), 
                        color: '#a1a1aa', 
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
                      color: '#ffffff',
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
                      <button
                        type="button"
                        onClick={() => playWordTts(displayWord, currentEntry?.reading)}
                        style={{ flexShrink: 0, background: '#18181b', border: '1px solid #27272a', borderRadius: '50%', width: '38px', height: '38px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#38bdf8', transition: 'all 0.15s' }}
                      >
                        <Volume2 size={18} />
                      </button>
                    </h2>
                  </div>

                  {showAnswer && <div style={{ borderBottom: '1px solid #18181b', width: '100%', marginBottom: '20px', marginTop: '10px' }}></div>}

                  {showAnswer ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'left' }}>
                      {currentEntry?.partsOfSpeech && currentEntry.partsOfSpeech.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {currentEntry.partsOfSpeech.filter((pos: string) => pos !== 'Yomitan').map((pos: string, i: number) => (
                            <span key={i} style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', color: '#f59e0b', fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                              {pos}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ 
                        color: '#e4e4e7', 
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
                          <p style={{ color: '#71717a', fontStyle: 'italic', fontSize: '0.85rem' }}>
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
                          background: '#18181b', 
                          border: '1px solid #27272a', 
                          borderRadius: '10px', 
                          padding: '14px 18px', 
                          marginTop: '8px', 
                          direction: 'ltr', 
                          textAlign: 'left' 
                        }}>
                          <p style={{ 
                            margin: 0, 
                            fontSize: fontSizeMode === 'S' ? '0.88rem' : (fontSizeMode === 'M' ? '1.02rem' : '1.18rem'), 
                            color: '#ffffff', 
                            fontFamily: 'var(--font-japanese)', 
                            lineHeight: '1.6' 
                          }}>
                            {srsCardData.sentence}
                          </p>
                          {srsCardData.source && (
                            <div style={{ fontSize: '0.74rem', color: '#71717a', marginTop: '6px', fontWeight: 600 }}>
                              Source: <span style={{ color: '#a1a1aa' }}>{srsCardData.source}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#71717a', fontSize: '0.95rem' }}>
                      {window.matchMedia?.('(pointer: coarse)').matches
                        ? (lang === 'es' ? 'Toca para mostrar' : 'Tap to reveal')
                        : (lang === 'es' ? 'Clic o Espacio para mostrar' : 'Click or press Space to reveal')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions Area */}
            {showAnswer ? (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* 4 Grading Buttons */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  
                  {/* Again */}
                  <button
                    type="button"
                    onClick={() => submitGrade(1)}
                    style={{
                      flex: 1,
                      padding: '12px 6px',
                      background: 'rgba(239, 68, 68, 0.04)',
                      border: '2px solid #ef4444',
                      borderRadius: '10px',
                      color: '#f87171',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.04)'}
                  >
                    <div style={{ fontSize: '0.72rem', opacity: 0.8, fontWeight: 700 }}>{intervals.again}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, margin: '2px 0' }}>Again</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.5, fontWeight: 700 }}>1</div>
                  </button>

                  {/* Hard */}
                  <button
                    type="button"
                    onClick={() => submitGrade(2)}
                    style={{
                      flex: 1,
                      padding: '12px 6px',
                      background: 'rgba(249, 115, 22, 0.04)',
                      border: '2px solid #f97316',
                      borderRadius: '10px',
                      color: '#fb923c',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(249, 115, 22, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(249, 115, 22, 0.04)'}
                  >
                    <div style={{ fontSize: '0.72rem', opacity: 0.8, fontWeight: 700 }}>{intervals.hard}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, margin: '2px 0' }}>Hard</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.5, fontWeight: 700 }}>2</div>
                  </button>

                  {/* Good */}
                  <button
                    type="button"
                    onClick={() => submitGrade(3)}
                    style={{
                      flex: 1,
                      padding: '12px 6px',
                      background: 'rgba(34, 197, 94, 0.04)',
                      border: '2px solid #22c55e',
                      borderRadius: '10px',
                      color: '#4ade80',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(34, 197, 94, 0.04)'}
                  >
                    <div style={{ fontSize: '0.72rem', opacity: 0.8, fontWeight: 700 }}>{intervals.good}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, margin: '2px 0' }}>Good</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.5, fontWeight: 700 }}>3</div>
                  </button>

                  {/* Easy */}
                  <button
                    type="button"
                    onClick={() => submitGrade(4)}
                    style={{
                      flex: 1,
                      padding: '12px 6px',
                      background: 'rgba(59, 130, 246, 0.04)',
                      border: '2px solid #3b82f6',
                      borderRadius: '10px',
                      color: '#60a5fa',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.04)'}
                  >
                    <div style={{ fontSize: '0.72rem', opacity: 0.8, fontWeight: 700 }}>{intervals.easy}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, margin: '2px 0' }}>Easy</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.5, fontWeight: 700 }}>4</div>
                  </button>
                </div>

                {/* Utility Buttons row */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={handleToggleBlacklist}
                    style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#ffffff', padding: '8px 18px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Ban size={13} style={{ color: '#ef4444' }} />
                    <span>Blacklist</span>
                    <span style={{ opacity: 0.5, fontSize: '0.66rem', border: '1px solid #27272a', padding: '1px 4px', borderRadius: '3px' }}>B</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleMaster}
                    style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#ffffff', padding: '8px 18px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Star size={13} style={{ color: '#f59e0b' }} />
                    <span>Master</span>
                    <span style={{ opacity: 0.5, fontSize: '0.66rem', border: '1px solid #27272a', padding: '1px 4px', borderRadius: '3px' }}>M</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={historyStack.length === 0}
                    style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: historyStack.length > 0 ? '#ffffff' : '#71717a', padding: '8px 18px', fontSize: '0.78rem', fontWeight: 700, cursor: historyStack.length > 0 ? 'pointer' : 'not-allowed', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '6px', opacity: historyStack.length > 0 ? 1 : 0.5 }}
                  >
                    <Undo2 size={13} />
                    <span>Undo</span>
                    <span style={{ opacity: 0.5, fontSize: '0.66rem', border: '1px solid #27272a', padding: '1px 4px', borderRadius: '3px' }}>Z</span>
                  </button>

                  <button
                    type="button"
                    style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#ffffff', padding: '8px 18px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span>... More</span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
                
                {/* Undo Z button */}
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={historyStack.length === 0}
                  style={{ background: 'transparent', border: 'none', color: historyStack.length > 0 ? '#a1a1aa' : '#3f3f46', fontSize: '0.78rem', fontWeight: 650, cursor: historyStack.length > 0 ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', transition: 'all 0.15s' }}
                >
                  <Undo2 size={13} />
                  <span>Undo Z</span>
                </button>

                {/* Show Answer button */}
                <button
                  type="button"
                  onClick={() => setShowAnswer(true)}
                  style={{
                    width: '100%',
                    padding: '16px',
                    background: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: '12px',
                    color: '#ffffff',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '12px',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#27272a'}
                  onMouseLeave={e => e.currentTarget.style.background = '#18181b'}
                >
                  <span>Show Answer</span>
                  <span style={{ fontSize: '0.74rem', background: '#27272a', color: '#a1a1aa', padding: '2px 8px', borderRadius: '4px' }}>Space</span>
                </button>
              </div>
            )}

            {/* Bottom Footer Options */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '24px', paddingBottom: '10px' }}>
              
              {/* Font Size Selector S M L */}
              <div style={{ display: 'flex', background: '#18181b', border: '1px solid #27272a', borderRadius: '20px', padding: '2px' }}>
                {(['S', 'M', 'L'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFontSizeMode(mode)}
                    style={{
                      background: fontSizeMode === mode ? '#3f3f46' : 'transparent',
                      border: 'none',
                      borderRadius: '50%',
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      color: fontSizeMode === mode ? '#ffffff' : '#71717a',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {/* Layouts toggle */}
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Columns size={16} />
              </button>

              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Settings size={16} />
              </button>

              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronDown size={16} />
              </button>
            </div>

          </div>
        )}
      </div>

    </div>
  );
}
