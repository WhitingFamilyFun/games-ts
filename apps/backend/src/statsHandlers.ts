/**
 * Stats ID management endpoints.
 * - claimStatsId: claim a public display name for leaderboards
 * - revokeStatsId: admin-only revocation
 * - getStatsId: look up a user's stats ID
 * - getStats: get a user's personal stats
 * - getLeaderboard: get top entries for a stat
 */
import { Effect, Schema } from "effect"
import { Database } from "./db.js"

const ADMIN_EMAIL = "tim@whitings.org"

// --- claimStatsId ---

const ClaimStatsIdRequest = Schema.Struct({
  uid: Schema.String,
  statsId: Schema.String,
})

export const claimStatsIdHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(ClaimStatsIdRequest)(body)
    const db = yield* Database

    const statsId = req.statsId.trim()

    // Check if user already has a stats ID
    const existing = (yield* db.get(`users/${req.uid}/statsId`)) as string | null
    if (existing) {
      return { error: "You already have a stats ID", statsId: existing }
    }

    // Validate format (admin bypasses)
    const email = (yield* db.get(`users/${req.uid}/email`)) as string | null
    const isAdmin = email === ADMIN_EMAIL

    if (!isAdmin) {
      if (statsId.length < 3 || statsId.length > 30) {
        return { error: "Stats ID must be 3-30 characters" }
      }
      if (!/^[a-zA-Z0-9_]+$/.test(statsId)) {
        return { error: "Stats ID can only contain letters, numbers, and underscores" }
      }
    }

    // Check if taken
    const taken = (yield* db.get(`statsIds/${statsId.toLowerCase()}`)) as string | null
    if (taken) {
      return { error: "That stats ID is already taken" }
    }

    // Claim it
    yield* db.set(`statsIds/${statsId.toLowerCase()}`, req.uid)
    yield* db.set(`users/${req.uid}/statsId`, statsId)

    return { success: true, statsId }
  })

// --- revokeStatsId ---

const RevokeStatsIdRequest = Schema.Struct({
  adminUid: Schema.String,
  statsId: Schema.String,
})

export const revokeStatsIdHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(RevokeStatsIdRequest)(body)
    const db = yield* Database

    // Verify admin
    const email = (yield* db.get(`users/${req.adminUid}/email`)) as string | null
    if (email !== ADMIN_EMAIL) {
      return { error: "Not authorized" }
    }

    const statsIdLower = req.statsId.toLowerCase()
    const uid = (yield* db.get(`statsIds/${statsIdLower}`)) as string | null
    if (!uid) {
      return { error: "Stats ID not found" }
    }

    // Remove mappings
    yield* db.remove(`statsIds/${statsIdLower}`)
    yield* db.remove(`users/${uid}/statsId`)

    return { success: true }
  })

// --- getStatsId ---

const GetStatsIdRequest = Schema.Struct({
  uid: Schema.String,
})

export const getStatsIdHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(GetStatsIdRequest)(body)
    const db = yield* Database

    const statsId = (yield* db.get(`users/${req.uid}/statsId`)) as string | null
    return { statsId }
  })

// --- getStats ---

const GetStatsRequest = Schema.Struct({
  uid: Schema.String,
})

export const getStatsHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(GetStatsRequest)(body)
    const db = yield* Database

    const stats = (yield* db.get(`users/${req.uid}/stats`)) as Record<string, number> | null
    return { stats: stats ?? {} }
  })

// --- getLeaderboard ---

const GetLeaderboardRequest = Schema.Struct({
  stat: Schema.String,
})

export const getLeaderboardHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(GetLeaderboardRequest)(body)
    const db = yield* Database

    const data = (yield* db.get(`leaderboard/${req.stat}`)) as Record<string, { statsId: string; value: number }> | null
    if (!data) return { entries: [] }

    // Sort and take top 10
    const entries = Object.entries(data)
      .map(([uid, entry]) => ({ uid, statsId: entry.statsId, value: entry.value }))
      .sort((a, b) => {
        // For "lowest" stats, sort ascending; for everything else, sort descending
        if (req.stat.includes("lowest")) return a.value - b.value
        return b.value - a.value
      })
      .slice(0, 10)

    return { entries }
  })
