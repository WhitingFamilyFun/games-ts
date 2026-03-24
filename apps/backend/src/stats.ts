/**
 * Stats recording helper for the backend.
 * Writes stat entries to users/{uid}/stats/ and leaderboard/ paths.
 */
import { Effect } from "effect"
import type { StatEntry } from "@games/effect-schemas"
import { Database } from "./db.js"

// Stat definitions: how each stat should be aggregated
type AggType = "sum" | "min" | "max"

const STAT_AGG: Record<string, AggType> = {
  // Flylo
  flylo_win: "sum",
  flylo_game_score: "sum",       // track as count of games
  flylo_round_score: "sum",      // track as count of rounds
  flylo_lowest_round: "min",
  flylo_highest_round: "max",
  // Flixx
  flixx_win: "sum",
  flixx_game_score: "max",       // track highest score
  // Fireworks
  fireworks_score: "max",        // track best score
  fireworks_perfect: "sum",
  fireworks_team: "sum",         // just count games
  // Glum
  glum_king_round: "sum",
}

// Map stat names to user-friendly counter names
const STAT_TO_USER_KEY: Record<string, string> = {
  flylo_win: "flylo_wins",
  flylo_game_score: "flylo_games",
  flylo_round_score: "flylo_rounds",
  flylo_lowest_round: "flylo_lowest_round",
  flylo_highest_round: "flylo_highest_round",
  flixx_win: "flixx_wins",
  flixx_game_score: "flixx_highest_score",
  fireworks_score: "fireworks_best_score",
  fireworks_perfect: "fireworks_perfects",
  fireworks_team: "fireworks_games",
  glum_king_round: "glum_king_rounds",
}

// Stats that should appear on the leaderboard
const LEADERBOARD_STATS = new Set([
  "flylo_wins",
  "flylo_lowest_round",
  "flylo_highest_round",
  "flixx_wins",
  "flixx_highest_score",
  "fireworks_best_score",
  "fireworks_perfects",
  "glum_king_rounds",
])

/**
 * Record a batch of stat entries to Firebase.
 * Updates per-user stats and leaderboard.
 */
export function recordStats(entries: StatEntry[]) {
  return Effect.gen(function* () {
    const db = yield* Database

    for (const entry of entries) {
      const userKey = STAT_TO_USER_KEY[entry.stat]
      if (!userKey) continue // unknown stat, skip

      const aggType = STAT_AGG[entry.stat] ?? "sum"
      const userPath = `users/${entry.playerId}/stats/${userKey}`

      // Read current value
      const current = (yield* db.get(userPath)) as number | null

      let newValue: number
      if (current === null) {
        newValue = entry.value
      } else {
        switch (aggType) {
          case "sum":
            newValue = current + entry.value
            break
          case "min":
            newValue = Math.min(current, entry.value)
            break
          case "max":
            newValue = Math.max(current, entry.value)
            break
        }
      }

      // Write user stat
      yield* db.set(userPath, newValue)

      // Write leaderboard entry if applicable
      if (LEADERBOARD_STATS.has(userKey)) {
        const statsId = (yield* db.get(`users/${entry.playerId}/statsId`)) as string | null
        if (statsId) {
          yield* db.set(`leaderboard/${userKey}/${entry.playerId}`, {
            statsId,
            value: newValue,
          })
        }
      }

      // Track game counts separately for "game score" type entries
      if (entry.stat === "flixx_game_score") {
        const gamesPath = `users/${entry.playerId}/stats/flixx_games`
        const gamesCount = ((yield* db.get(gamesPath)) as number | null) ?? 0
        yield* db.set(gamesPath, gamesCount + 1)
      } else if (entry.stat === "flylo_game_score") {
        // flylo_game_score maps to flylo_games (count)
        // value is already incremented as count via "sum" aggregation
      }
    }
  })
}
