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
