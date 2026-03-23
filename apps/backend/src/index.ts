import * as functions from "firebase-functions/v2"
import * as admin from "firebase-admin"
import express from "express"
import cors from "cors"
import { Effect, Exit, Cause, Option } from "effect"
import { registerAllGames } from "@games/game-engine"
import { Database } from "./db.js"
import { FirebaseDatabaseLive } from "./db.js"
import { mapErrorToStatus } from "./utils.js"
import {
  createGameHandler,
  joinGameHandler,
  deleteGameHandler,
  getGamesHandler,
  startGameHandler,
  sendEventHandler,
  nextRoundHandler,
  getGameStateHandler,
  getLobbyHandler,
} from "./handlers.js"

// Initialize Firebase Admin SDK
admin.initializeApp()

// Register all game types
registerAllGames()

// Bridge Effect programs to Express handlers
const wrapHandler =
  (handler: (body: unknown) => Effect.Effect<unknown, unknown, Database>) =>
  async (req: express.Request, res: express.Response): Promise<void> => {
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
        // Defect or interruption
        console.error("Unexpected error:", Cause.pretty(exit.cause))
        res.status(500).json({ error: "Internal server error" })
      }
    }
  }

// Express app
const app = express()
app.use(cors({ origin: true }))
app.use(express.json())

// Game service routes
app.post("/createGame", wrapHandler(createGameHandler))
app.post("/joinGame", wrapHandler(joinGameHandler))
app.post("/deleteGame", wrapHandler(deleteGameHandler))
app.post("/getGames", wrapHandler(getGamesHandler))

// Round service routes
app.post("/startGame", wrapHandler(startGameHandler))
app.post("/sendEvent", wrapHandler(sendEventHandler))
app.post("/nextRound", wrapHandler(nextRoundHandler))

// Polling routes
app.post("/getGameState", wrapHandler(getGameStateHandler))
app.post("/getLobby", wrapHandler(getLobbyHandler))

// Export as Firebase Cloud Function v2
export const api = functions.https.onRequest(app)
