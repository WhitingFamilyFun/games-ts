/**
 * Stats API helpers — calls Cloud Functions and reads Firebase RTDB for stats.
 */
import { ref, get } from "firebase/database"
import { database } from "./firebase.js"

// Cloud Functions base URL
const FUNCTIONS_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL) ||
  "https://us-central1-whitingfamilygames.cloudfunctions.net"

async function callFunction(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json()
}

// --- Stats ID management ---

export async function claimStatsId(uid: string, statsId: string) {
  return callFunction("claimStatsId", { uid, statsId })
}

export async function getStatsId(uid: string): Promise<string | null> {
  const result = await callFunction("getStatsId", { uid })
  return result.statsId ?? null
}

// --- Personal stats ---

export interface UserStats {
  flylo_wins?: number
  flylo_games?: number
  flylo_rounds?: number
  flylo_lowest_round?: number
  flylo_highest_round?: number
  flixx_wins?: number
  flixx_highest_score?: number
  flixx_games?: number
  fireworks_best_score?: number
  fireworks_perfects?: number
  fireworks_games?: number
  glum_king_rounds?: number
  glum_games?: number
}

export async function getUserStats(uid: string): Promise<UserStats> {
  const snap = await get(ref(database, `users/${uid}/stats`))
  return (snap.val() as UserStats) ?? {}
}

// --- Leaderboard ---

export interface LeaderboardEntry {
  uid: string
  statsId: string
  value: number
}

const LEADERBOARD_STATS = [
  "flylo_wins",
  "flylo_lowest_round",
  "flylo_highest_round",
  "flixx_wins",
  "flixx_highest_score",
  "fireworks_best_score",
  "fireworks_perfects",
  "glum_king_rounds",
] as const

export type LeaderboardStat = typeof LEADERBOARD_STATS[number]

export { LEADERBOARD_STATS }

export async function getLeaderboard(stat: string): Promise<LeaderboardEntry[]> {
  const snap = await get(ref(database, `leaderboard/${stat}`))
  const data = snap.val() as Record<string, { statsId: string; value: number }> | null
  if (!data) return []

  return Object.entries(data)
    .map(([uid, entry]) => ({ uid, statsId: entry.statsId, value: entry.value }))
    .sort((a, b) => {
      if (stat.includes("lowest")) return a.value - b.value
      return b.value - a.value
    })
    .slice(0, 10)
}
