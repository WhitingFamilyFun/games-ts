import { describe, it, expect } from "vitest"
import {
  updateStatus,
  addReadyPlayer,
  allPlayersReady,
  finishRound,
  addRewards,
  initGenericFields,
} from "./generic.js"
import type { PlayerId, GenericFields, GameStatus } from "./common.js"

// A fake game type to prove helpers preserve the concrete type
type FakeGame = GenericFields & { readonly type: "Fake"; readonly board: string[] }

const makeFakeGame = (): FakeGame => ({
  ...initGenericFields([
    { id: "p1" as PlayerId, name: "Alice" },
    { id: "p2" as PlayerId, name: "Bob" },
  ]),
  type: "Fake",
  board: ["", "", ""],
})

describe("generic helpers preserve concrete type", () => {
  it("updateStatus returns FakeGame, not GenericFields", () => {
    const game = makeFakeGame()
    const next = updateStatus(game, "betweenRounds")
    expect(next.type).toBe("Fake")
    expect(next.board).toEqual(["", "", ""])
    expect(next.status).toBe("betweenRounds")
    expect(game.status).toBe("started")
  })

  it("addReadyPlayer is idempotent", () => {
    const game = makeFakeGame()
    const g2 = addReadyPlayer(game, "p1" as PlayerId)
    const g3 = addReadyPlayer(g2, "p1" as PlayerId)
    expect(g2.readyPlayers).toEqual(["p1"])
    expect(g3.readyPlayers).toEqual(["p1"])
    expect(g3.type).toBe("Fake")
  })

  it("allPlayersReady checks all players", () => {
    const game = makeFakeGame()
    expect(allPlayersReady(game)).toBe(false)
    const g2 = addReadyPlayer(addReadyPlayer(game, "p1" as PlayerId), "p2" as PlayerId)
    expect(allPlayersReady(g2)).toBe(true)
  })

  it("finishRound increments and resets", () => {
    const game = updateStatus(makeFakeGame(), "betweenRounds")
    const next = finishRound(game)
    expect(next.round).toBe(2)
    expect(next.status).toBe("started")
    expect(next.readyPlayers).toEqual([])
    expect(next.board).toEqual(["", "", ""])
  })

  it("addRewards accumulates", () => {
    const game = makeFakeGame()
    const r1 = addRewards(game, [5, 3])
    const r2 = addRewards(r1, [2, 7])
    expect(r2.rewards).toEqual([7, 10])
    expect(r2.type).toBe("Fake")
  })

  it("initGenericFields creates correct defaults", () => {
    const g = initGenericFields([{ id: "p1" as PlayerId, name: "A" }])
    expect(g.status).toBe("started")
    expect(g.round).toBe(1)
    expect(g.players).toHaveLength(1)
    expect(g.readyPlayers).toEqual([])
    expect(g.rewards).toEqual([0])
  })
})
