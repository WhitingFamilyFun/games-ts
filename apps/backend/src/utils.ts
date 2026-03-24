import { Effect } from "effect"
import type { GameError } from "@games/effect-schemas"
import { Database } from "./db.js"

// --- Game code generation ---

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const CODE_LENGTH = 4

/** Generate a random game code that doesn't collide with existing games */
export const generateGameCode = (): Effect.Effect<string, never, Database> =>
  Effect.gen(function* () {
    const db = yield* Database
    // Try up to 10 times to find a unique code
    for (let attempt = 0; attempt < 10; attempt++) {
      let code = ""
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
      }
      const existing = yield* db.get(`games/${code}/lobby`)
      if (existing == null) {
        return code
      }
    }
    // Fallback: use timestamp-based code
    return Date.now().toString(36).toUpperCase().slice(-CODE_LENGTH)
  })

// --- Firebase RTDB normalization ---
// Firebase RTDB strips: empty arrays → undefined, null values → undefined,
// empty objects → undefined, arrays → numeric-keyed objects.
// This deep-normalizes data before Schema decoding.

export function normalizeFirebaseState(data: unknown): unknown {
  if (data == null) return data
  if (typeof data !== "object") return data
  if (Array.isArray(data)) return data.map(normalizeFirebaseState)

  const obj = data as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    result[key] = normalizeFirebaseState(value)
  }

  // Convert numeric-keyed objects back to arrays (Firebase converts arrays this way)
  const keys = Object.keys(result)
  if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
    const arr: unknown[] = []
    for (const k of keys) arr[Number(k)] = result[k]
    return arr
  }

  // Restore deck fields: discardPile, drawPile should have { cards: [] }
  // Firebase strips these entirely when cards is empty
  const hasGameType = "type" in result && typeof result["type"] === "string"
  for (const field of ["discardPile", "drawPile"]) {
    if (!(field in result) || result[field] == null) {
      // Only add if this looks like a game state (has a type field)
      if (hasGameType) result[field] = { cards: [] }
    } else if (typeof result[field] === "object" && result[field] !== null) {
      const deck = result[field] as Record<string, unknown>
      if (!("cards" in deck)) deck["cards"] = []
    }
  }

  // If this looks like a player object with a missing deck
  if (("currentScore" in result || "discardToFlip" in result) && !("deck" in result)) {
    result["deck"] = { cards: [] }
  }
  if ("deck" in result && result["deck"] == null) {
    result["deck"] = { cards: [] }
  }
  if ("deck" in result && typeof result["deck"] === "object" && result["deck"] !== null) {
    const deck = result["deck"] as Record<string, unknown>
    if (!("cards" in deck)) deck["cards"] = []
  }

  // Only restore nullable/array fields on game-state-level objects (those with a `type` field)
  if (hasGameType) {
    for (const field of ["firstPlayerOutIndex", "nextPlayerIndex", "playerOut", "hintForPlayer", "showColor", "showNumber"]) {
      if (!(field in result)) result[field] = null
    }
    for (const field of ["readyPlayers", "rewards", "outIndex", "finishedSetup", "playersSubmittedForRound"]) {
      if (!(field in result)) result[field] = []
    }
  }

  // Restore card:null on flylo player objects (have currentScore + deck but missing card)
  if ("currentScore" in result && "deck" in result && !("card" in result)) {
    result["card"] = null
  }

  // Restore pile.sets
  if ("pile" in result && typeof result["pile"] === "object" && result["pile"] !== null) {
    const pile = result["pile"] as Record<string, unknown>
    if (!("sets" in pile)) pile["sets"] = []
  }

  // Restore declaredValue on GlumSet objects
  if ("cards" in result && !("declaredValue" in result) && !("color" in result) && !("number" in result)) {
    // Only if this looks like a GlumSet (has cards but no color/number which would be a GameCard/FireworksCard)
    if (Array.isArray(result["cards"]) && result["cards"].length > 0 && typeof result["cards"][0] === "object" && result["cards"][0] !== null && ("kind" in (result["cards"][0] as object) || "suit" in (result["cards"][0] as object))) {
      result["declaredValue"] = null
    }
  }

  return result
}

// --- Firebase write sanitization ---
// Firebase RTDB rejects undefined values. Convert them to null for storage.

export function sanitizeForFirebase(data: unknown): unknown {
  if (data === undefined) return null
  if (data === null) return null
  if (typeof data !== "object") return data
  if (Array.isArray(data)) return data.map(sanitizeForFirebase)
  const obj = data as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const sanitized = sanitizeForFirebase(value)
    if (sanitized !== null) {
      result[key] = sanitized
    }
    // Skip null values entirely — Firebase will interpret missing keys as null on read
  }
  return result
}

// --- Error mapping ---

export const mapErrorToStatus = (
  error: GameError | unknown
): { status: number; message: string } => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tagged = error as { _tag: string; message?: string }
    switch (tagged._tag) {
      case "GameNotFound":
        return { status: 404, message: "Game not found" }
      case "InvalidMove":
        return { status: 400, message: tagged.message ?? "Invalid move" }
      case "NotYourTurn":
        return { status: 400, message: "Not your turn" }
      case "GameFull":
        return { status: 400, message: "Game is full" }
      case "NotAdmin":
        return { status: 403, message: "Not admin" }
      case "InvalidGameState":
        return { status: 400, message: "Invalid game state" }
      case "ParseError":
        return { status: 400, message: "Invalid request body" }
      default:
        return { status: 500, message: "Internal server error" }
    }
  }
  return { status: 500, message: "Internal server error" }
}
