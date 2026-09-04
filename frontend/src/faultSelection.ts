import type { Fault } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'random';

const NO_FAULTS_FALLBACK: Fault = { id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] };

export function pickRandomFault(faults: Fault[], difficulty: Difficulty, rng: () => number = Math.random): Fault {
  const nonHealthy = faults.filter((f) => f.id !== 'healthy');
  const pool = difficulty === 'random' ? nonHealthy : nonHealthy.filter((f) => f.difficulty === difficulty);
  const candidates = pool.length > 0 ? pool : nonHealthy;

  if (candidates.length === 0) {
    return faults.find((f) => f.id === 'healthy') ?? faults[0] ?? NO_FAULTS_FALLBACK;
  }

  return candidates[Math.floor(rng() * candidates.length)];
}
