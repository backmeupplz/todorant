import { hero } from '../data/store'

/** Hero levels: points needed for each rank (the apps' ranks.ts) */
export const RANKS = [0, 5, 13, 42, 69, 85, 100, 221, 256, 300, 404, 777, 800, 1337, 1338, 2048, 9000, 12800, 1000000]

/** Current rank threshold, next one and progress between them (0..1) */
export function rank(points = hero.value) {
  const i = RANKS.findIndex((r) => r > points)
  if (i <= 0) return { level: RANKS.length - 1, rank: RANKS.at(-1)!, next: RANKS.at(-1)!, progress: 1 }
  const rank = RANKS[i - 1]
  const next = RANKS[i]
  return { level: i - 1, rank, next, progress: (points - rank) / (next - rank) }
}

/** 1234 → 1.2k, like the apps' hero button */
export const shortNumber = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${n}`)
