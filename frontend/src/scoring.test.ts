import { describe, expect, it } from 'vitest';
import { INITIAL_SCORE, recordGuess } from './scoring';

describe('recordGuess', () => {
  it('counts a correct first-try guess as solved and extends the streak', () => {
    const score = recordGuess(INITIAL_SCORE, true, true);
    expect(score).toEqual({ solved: 1, attempts: 1, currentStreak: 1, bestStreak: 1 });
  });

  it('counts a wrong first-try guess as an attempt, resetting the streak to 0', () => {
    const withStreak = { solved: 3, attempts: 3, currentStreak: 3, bestStreak: 3 };
    const score = recordGuess(withStreak, false, true);
    expect(score).toEqual({ solved: 3, attempts: 4, currentStreak: 0, bestStreak: 3 });
  });

  it('a later correct guess in the same round counts as solved but not toward the streak', () => {
    // firstTryThisRound is false because an earlier wrong guess already
    // happened this round (and already broke the streak to 0)
    const afterAWrongGuess = { solved: 0, attempts: 1, currentStreak: 0, bestStreak: 0 };
    const score = recordGuess(afterAWrongGuess, true, false);
    expect(score).toEqual({ solved: 1, attempts: 2, currentStreak: 0, bestStreak: 0 });
  });

  it('keeps bestStreak at its high-water mark after the streak later breaks', () => {
    let score = INITIAL_SCORE;
    score = recordGuess(score, true, true); // streak 1
    score = recordGuess(score, true, true); // streak 2
    score = recordGuess(score, false, true); // breaks to 0
    expect(score.currentStreak).toBe(0);
    expect(score.bestStreak).toBe(2);
  });
});
