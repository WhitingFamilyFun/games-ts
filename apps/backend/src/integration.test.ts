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

// Helper to run a full create → join → start lifecycle for any game type
async function createAndStartGame(gameType: string, options: Record<string, unknown> = {}) {
  const createResult = (await run(
    handlers.createGameHandler({
      playerID: "alice",
      config: { gameType, adminID: "alice", options: { randomSeed: 42, ...options } },
    })
  )) as { code: string }
  const { code } = createResult

  await run(handlers.joinGameHandler({ code, playerID: "alice", name: "Alice" }))
  await run(handlers.joinGameHandler({ code, playerID: "bob", name: "Bob" }))

  const startResult = (await run(
    handlers.startGameHandler({ code, playerID: "alice" })
  )) as unknown as { state: { type: string; status: string } }

  return { code, state: startResult.state }
}

describe("Game lifecycle — all game types", () => {
  it("Flylo: create → join → start → verify state in DB", async () => {
    const { code, state } = await createAndStartGame("Flylo")
    expect(state.type).toBe("Flylo")
    expect(state.status).toBe("started")

    const stateSnap = await admin.database().ref(`games/${code}/state`).get()
    expect(stateSnap.val().type).toBe("Flylo")
  })

  it("Flixx: create → join → start → verify state in DB", async () => {
    const { code, state } = await createAndStartGame("Flixx")
    expect(state.type).toBe("Flixx")
    expect(state.status).toBe("started")

    const stateSnap = await admin.database().ref(`games/${code}/state`).get()
    expect(stateSnap.val().type).toBe("Flixx")
  })

  it("Fireworks: create → join → start → verify state in DB", async () => {
    const { code, state } = await createAndStartGame("Fireworks")
    expect(state.type).toBe("Fireworks")
    expect(state.status).toBe("started")

    const stateSnap = await admin.database().ref(`games/${code}/state`).get()
    const dbState = stateSnap.val()
    expect(dbState.type).toBe("Fireworks")
    expect(dbState.numClocks).toBe(8)
    expect(dbState.numFuses).toBe(3)
  })

  it("Glum: create → join → start → verify state in DB", async () => {
    const { code, state } = await createAndStartGame("Glum")
    expect(state.type).toBe("Glum")
    expect(state.status).toBe("started")

    const stateSnap = await admin.database().ref(`games/${code}/state`).get()
    const dbState = stateSnap.val()
    expect(dbState.type).toBe("Glum")
    expect(dbState.glumPlayers).toHaveLength(2)
  })

  it("Flylo: sendEvent works through DB round-trip", async () => {
    const { code } = await createAndStartGame("Flylo")

    // Send a flip event
    const eventResult = (await run(
      handlers.sendEventHandler({
        code,
        playerID: "alice",
        event: { kind: "flip", index: 0 },
      })
    )) as { state: any }
    expect(eventResult.state).toBeDefined()

    // Verify state persisted in DB
    const stateSnap = await admin.database().ref(`games/${code}/state`).get()
    expect(stateSnap.exists()).toBe(true)
  })

  it("Fireworks: sendEvent (discard) works", async () => {
    const { code, state: startState } = await createAndStartGame("Fireworks")

    // Use the state returned from startGame (not re-read from DB) to get a valid card
    const fw = startState as any
    const currentPlayerId = fw.playerIds[fw.currentPlayerIndex]
    const card = fw.fireworksPlayers[fw.currentPlayerIndex].cards[0]

    const eventResult = (await run(
      handlers.sendEventHandler({
        code,
        playerID: currentPlayerId,
        event: { kind: "fw_discard", card: { color: card.color, number: card.number } },
      })
    )) as { state: any }
    expect(eventResult.state).toBeDefined()
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

    // Game should be gone — verify directly from DB
    const stateSnap = await admin.database().ref(`games/${code}/state`).get()
    expect(stateSnap.exists()).toBe(false)
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

    // Read lobby directly from DB (replaces getLobby polling endpoint)
    const lobbySnap = await admin.database().ref(`games/${code}/lobby`).get()
    const lobbyData = lobbySnap.val() as { players: Array<{ id: string }> }
    expect(lobbyData.players).toHaveLength(1)
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
