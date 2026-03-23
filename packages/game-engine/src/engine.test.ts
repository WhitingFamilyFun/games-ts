import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { GameRegistry, type GameFunctions } from "./engine.js"
import type { GenericFields, GameConfig, Player, PlayerId } from "@games/effect-schemas"
import { InvalidMove, initGenericFields } from "@games/effect-schemas"

// Minimal test game that extends GenericFields
type TestGame = GenericFields & { readonly type: "Flylo"; readonly board: readonly string[] }
interface TestEvent { readonly position: number }

const testFunctions: GameFunctions<TestGame, TestEvent> = {
  gameType: "Flylo",
  initialState: (_config, players) =>
    Effect.succeed({
      ...initGenericFields(players),
      type: "Flylo" as const,
      board: Array(9).fill(""),
    }),
  next: (state, _config, playerId, event) => {
    if (event.position < 0 || event.position > 8)
      return Effect.fail(new InvalidMove({ message: "Out of range", playerId }))
    const board = [...state.board]
    board[event.position] = playerId
    return Effect.succeed({ ...state, board })
  },
  nextRound: (state, _config) =>
    Effect.succeed({ ...state, board: Array(9).fill("") }),
  isRoundOver: (_state) => false,
  isGameOver: (_state) => false,
}

describe("GameRegistry", () => {
  beforeEach(() => GameRegistry.clear())

  it("registers and retrieves game functions", () => {
    GameRegistry.register(testFunctions)
    expect(GameRegistry.has("Flylo")).toBe(true)
    expect(GameRegistry.get("Flylo")).toBeDefined()
  })

  it("lists registered types", () => {
    GameRegistry.register(testFunctions)
    expect(GameRegistry.registeredTypes()).toContain("Flylo")
  })

  it("throws for unregistered type", () => {
    expect(() => GameRegistry.get("Flixx")).toThrow()
  })

  it("initialState includes generic fields", async () => {
    GameRegistry.register(testFunctions)
    const fns = GameRegistry.get("Flylo")
    const config = { gameType: "Flylo" as const, rounds: 1, minPlayers: 2, maxPlayers: 4, options: {} } as any
    const players = [{ id: "p1" as PlayerId, name: "A" }]
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(1)
    expect(state.rewards).toEqual([0])
  })
})
