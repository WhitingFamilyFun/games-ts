import { describe, it, expect, beforeAll, afterEach } from "vitest"
import * as admin from "firebase-admin"
import { Effect, Exit, Cause } from "effect"
import { registerAllGames } from "@games/game-engine"
import { Database, FirebaseDatabaseLive } from "./db.js"
import * as handlers from "./handlers.js"

// Tests should be run with FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000

const PROJECT_ID = "whitingfamilygames"

beforeAll(() => {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: PROJECT_ID,
      databaseURL: `http://127.0.0.1:9000/?ns=${PROJECT_ID}-default-rtdb`,
    })
  }
  registerAllGames()
})

afterEach(async () => {
  await admin.database().ref("/").remove()
})

// Helper to run a handler Effect against the real emulator DB
const run = <A>(effect: Effect.Effect<A, unknown, Database>) =>
  Effect.runPromise(Effect.provide(effect, FirebaseDatabaseLive))

const runExit = <A>(effect: Effect.Effect<A, unknown, Database>) =>
  Effect.runPromiseExit(Effect.provide(effect, FirebaseDatabaseLive))

describe("Game lifecycle", () => {
  it("create → join → getLobby → start", async () => {
    // Create game
    const createResult = (await run(
      handlers.createGameHandler({
        playerID: "alice",
        config: { gameType: "Flylo", adminID: "alice", options: { randomSeed: 42 } },
      })
    )) as { code: string }
    expect(createResult.code).toBeTruthy()
    const { code } = createResult

    // Join 2 players
    await run(handlers.joinGameHandler({ code, playerID: "alice", name: "Alice" }))
    await run(handlers.joinGameHandler({ code, playerID: "bob", name: "Bob" }))

    // Get lobby
    const lobbyResult = (await run(handlers.getLobbyHandler({ code }))) as {
      lobby: { players: Array<{ id: string; name: string }>; gameStatus: string }
    }
    expect(lobbyResult.lobby.players).toHaveLength(2)
    expect(lobbyResult.lobby.gameStatus).toBe("lobby")

    // Start game
    const startResult = (await run(
      handlers.startGameHandler({ code, playerID: "alice" })
    )) as unknown as { state: { type: string; status: string } }
    expect(startResult.state.type).toBe("Flylo")
    expect(startResult.state.status).toBe("started")

    // Get game state
    const stateResult = (await run(handlers.getGameStateHandler({ code }))) as {
      state: { type: string }
    }
    expect(stateResult.state.type).toBe("Flylo")
  })

  it("create → join → delete", async () => {
    const createResult = (await run(
      handlers.createGameHandler({
        playerID: "alice",
        config: { gameType: "Flylo", adminID: "alice" },
      })
    )) as { code: string }
    const { code } = createResult

    await run(handlers.joinGameHandler({ code, playerID: "alice", name: "Alice" }))

    const deleteResult = (await run(
      handlers.deleteGameHandler({ code, playerID: "alice" })
    )) as { success: boolean }
    expect(deleteResult.success).toBe(true)

    // Game should be gone
    const exit = await runExit(handlers.getGameStateHandler({ code }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("getGames returns player's games", async () => {
    const createResult = (await run(
      handlers.createGameHandler({
        playerID: "alice",
        config: { gameType: "Flylo", adminID: "alice" },
      })
    )) as { code: string }

    await run(
      handlers.joinGameHandler({
        code: createResult.code,
        playerID: "alice",
        name: "Alice",
      })
    )

    const gamesResult = (await run(
      handlers.getGamesHandler({ playerID: "alice" })
    )) as { games: Array<{ gameID: string }> }
    expect(gamesResult.games).toHaveLength(1)
    expect(gamesResult.games[0]!.gameID).toBe(createResult.code)
  })

  it("joining same game twice is idempotent", async () => {
    const createResult = (await run(
      handlers.createGameHandler({
        playerID: "alice",
        config: { gameType: "Flylo", adminID: "alice" },
      })
    )) as { code: string }
    const { code } = createResult

    await run(handlers.joinGameHandler({ code, playerID: "alice", name: "Alice" }))
    await run(handlers.joinGameHandler({ code, playerID: "alice", name: "Alice" }))

    const lobbyResult = (await run(handlers.getLobbyHandler({ code }))) as {
      lobby: { players: Array<{ id: string }> }
    }
    expect(lobbyResult.lobby.players).toHaveLength(1)
  })
})

describe("error cases", () => {
  it("rejects joining nonexistent game", async () => {
    const exit = await runExit(
      handlers.joinGameHandler({ code: "ZZZZ", playerID: "alice", name: "Alice" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects starting nonexistent game", async () => {
    const exit = await runExit(
      handlers.startGameHandler({ code: "ZZZZ", playerID: "alice" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects deleting nonexistent game", async () => {
    const exit = await runExit(
      handlers.deleteGameHandler({ code: "ZZZZ", playerID: "alice" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects getGameState for nonexistent game", async () => {
    const exit = await runExit(handlers.getGameStateHandler({ code: "ZZZZ" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects starting an already started game", async () => {
    const createResult = (await run(
      handlers.createGameHandler({
        playerID: "alice",
        config: { gameType: "Flylo", adminID: "alice", options: { randomSeed: 42 } },
      })
    )) as { code: string }
    const { code } = createResult

    await run(handlers.joinGameHandler({ code, playerID: "alice", name: "Alice" }))
    await run(handlers.joinGameHandler({ code, playerID: "bob", name: "Bob" }))
    await run(handlers.startGameHandler({ code, playerID: "alice" }))

    // Try to start again
    const exit = await runExit(
      handlers.startGameHandler({ code, playerID: "alice" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects invalid request body", async () => {
    const exit = await runExit(handlers.createGameHandler({ bad: "data" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
