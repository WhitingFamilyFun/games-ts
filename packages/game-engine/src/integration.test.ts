import { describe, it, expect, beforeAll } from "vitest"
import { Effect } from "effect"
import { GameRegistry } from "./engine.js"
import { registerAllGames } from "./register.js"
import type { PlayerId, GameConfig, Player, GameType } from "@games/effect-schemas"
import { updateStatus, addReadyPlayer } from "@games/effect-schemas"

beforeAll(() => {
  GameRegistry.clear()
  registerAllGames()
})

const players: Player[] = [
  { id: "p1" as PlayerId, name: "Alice" },
  { id: "p2" as PlayerId, name: "Bob" },
]

const makeConfig = (gameType: GameType, opts: Record<string, unknown> = {}): GameConfig => ({
  gameType,
  adminID: "p1" as PlayerId,
  rounds: 4, minPlayers: 2, maxPlayers: 6,
  options: { randomSeed: 42, ...opts },
})

describe("All game types registered", () => {
  it("all 4 game types are registered", () => {
    expect(GameRegistry.has("Flylo")).toBe(true)
    expect(GameRegistry.has("Flixx")).toBe(true)
    expect(GameRegistry.has("Fireworks")).toBe(true)
    expect(GameRegistry.has("Glum")).toBe(true)
    expect(GameRegistry.registeredTypes()).toHaveLength(4)
  })
})

describe("Flylo lifecycle via registry", () => {
  const config = makeConfig("Flylo")

  it("creates initial state with GenericFields", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(2)
    expect(state.rewards).toEqual([0, 0])
  })

  it("generic helpers work on registry-returned state", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    const paused = updateStatus(state, "betweenRounds")
    expect(paused.status).toBe("betweenRounds")
    const ready = addReadyPlayer(paused, "p1" as PlayerId)
    expect(ready.readyPlayers).toEqual(["p1"])
  })

  it("processes flip event", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    const next = await Effect.runPromise(
      fns.next(state, config, "p1" as PlayerId, { kind: "flip", index: 0 })
    )
    expect(next).toBeDefined()
  })
})

describe("Flixx lifecycle via registry", () => {
  const config = makeConfig("Flixx")

  it("creates initial state with GenericFields", async () => {
    const fns = GameRegistry.get("Flixx")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(2)
  })

  it("processes roll event", async () => {
    const fns = GameRegistry.get("Flixx")
    const state = await Effect.runPromise(fns.initialState(config, players))
    const currentPlayer = state.players[state.currentPlayerIndex]!
    const next = await Effect.runPromise(
      fns.next(state, config, currentPlayer.id, { kind: "roll" })
    )
    expect(next).toBeDefined()
  })
})

describe("Fireworks lifecycle via registry", () => {
  const config = makeConfig("Fireworks")

  it("creates initial state with GenericFields", async () => {
    const fns = GameRegistry.get("Fireworks")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(2)
    expect(state.rewards).toEqual([0, 0])
  })

  it("processes discard event", async () => {
    const fns = GameRegistry.get("Fireworks")
    const state = await Effect.runPromise(fns.initialState(config, players)) as any
    const currentPlayer = state.players[state.currentPlayerIndex]!
    // Discard the first card in the current player's hand
    const playerHand = state.fireworksPlayers[state.currentPlayerIndex]
    const card = playerHand.cards[0]
    const next = await Effect.runPromise(
      fns.next(state, config, currentPlayer.id, { kind: "fw_discard", card })
    )
    expect(next).toBeDefined()
  })

  it("is a single-round game", async () => {
    const fns = GameRegistry.get("Fireworks")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(fns.isRoundOver(state)).toBe(false)
    expect(fns.isGameOver(state, config)).toBe(false)
  })
})

describe("Glum lifecycle via registry", () => {
  const config = makeConfig("Glum")

  it("creates initial state with GenericFields", async () => {
    const fns = GameRegistry.get("Glum")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(2)
    expect(state.rewards).toEqual([0, 0])
  })

  it("processes a play event", async () => {
    const fns = GameRegistry.get("Glum")
    const state = await Effect.runPromise(fns.initialState(config, players)) as any
    const currentPlayer = state.players[state.currentPlayerIndex]!
    const glumPlayer = state.glumPlayers[state.currentPlayerIndex]
    // Play the first card as a single-card set
    if (glumPlayer.deck.length > 0) {
      const card = glumPlayer.deck[0]
      const next = await Effect.runPromise(
        fns.next(state, config, currentPlayer.id, {
          kind: "glum_playSet",
          glumSet: { cards: [card], declaredValue: null },
        })
      )
      expect(next).toBeDefined()
    }
  })

  it("is a multi-round game", async () => {
    const fns = GameRegistry.get("Glum")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(fns.isRoundOver(state)).toBe(false)
    // Game over requires all rounds played
    expect(fns.isGameOver(state, config)).toBe(false)
  })
})
