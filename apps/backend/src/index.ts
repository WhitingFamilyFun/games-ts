import { onRequest } from "firebase-functions/v2/https"
import * as admin from "firebase-admin"
import { Effect, Exit, Cause, Option } from "effect"
import { registerAllGames } from "@games/game-engine"
import { Database, FirebaseDatabaseLive } from "./db.js"
import { mapErrorToStatus } from "./utils.js"
import * as handlers from "./handlers.js"
import * as statsHandlers from "./statsHandlers.js"

admin.initializeApp()
registerAllGames()

function wrapHandler(handler: (body: unknown) => Effect.Effect<unknown, unknown, Database>) {
  return onRequest({ cors: true }, async (req, res) => {
    const program = handler(req.body).pipe(Effect.provide(FirebaseDatabaseLive))
    const exit = await Effect.runPromiseExit(program)
    if (Exit.isSuccess(exit)) {
      res.json(exit.value)
    } else {
      const failureOpt = Cause.failureOption(exit.cause)
      if (Option.isSome(failureOpt)) {
        const { status, message } = mapErrorToStatus(failureOpt.value)
        res.status(status).json({ error: message })
      } else {
        console.error("Unexpected error:", Cause.pretty(exit.cause))
        res.status(500).json({ error: "Internal server error" })
      }
    }
  })
}

// Export individual Cloud Functions
export const createGame = wrapHandler(handlers.createGameHandler)
export const joinGame = wrapHandler(handlers.joinGameHandler)
export const deleteGame = wrapHandler(handlers.deleteGameHandler)
export const getGames = wrapHandler(handlers.getGamesHandler)
export const startGame = wrapHandler(handlers.startGameHandler)
export const sendEvent = wrapHandler(handlers.sendEventHandler)
export const nextRound = wrapHandler(handlers.nextRoundHandler)
// Stats endpoints
export const claimStatsId = wrapHandler(statsHandlers.claimStatsIdHandler)
export const revokeStatsId = wrapHandler(statsHandlers.revokeStatsIdHandler)
export const getStatsId = wrapHandler(statsHandlers.getStatsIdHandler)
export const getStats = wrapHandler(statsHandlers.getStatsHandler)
export const getLeaderboard = wrapHandler(statsHandlers.getLeaderboardHandler)
// getGameState and getLobby removed — replaced by Firebase RTDB real-time listeners
