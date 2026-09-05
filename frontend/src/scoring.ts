// Session score, shared across every device and both views (schematic/PCB) --
// lives in App.tsx, not in the per-device view components, since switching
// devices remounts those (see probeSelection's `key={deviceId}` fix) but the
// score must survive that.
export interface ScoreState {
  solved: number;
  attempts: number;
  currentStreak: number;
  bestStreak: number;
}

export const INITIAL_SCORE: ScoreState = { solved: 0, attempts: 0, currentStreak: 0, bestStreak: 0 };

// Call once per guess submission. `firstTryThisRound` is whether this is the
// first guess made since the current fault was drawn: only a correct FIRST
// guess extends the streak, and any wrong guess breaks it immediately (a
// later correct guess in the same round still counts as solved, just not
// toward the streak).
export function recordGuess(score: ScoreState, correct: boolean, firstTryThisRound: boolean): ScoreState {
  const currentStreak = firstTryThisRound ? (correct ? score.currentStreak + 1 : 0) : score.currentStreak;
  return {
    solved: score.solved + (correct ? 1 : 0),
    attempts: score.attempts + 1,
    currentStreak,
    bestStreak: Math.max(score.bestStreak, currentStreak),
  };
}
