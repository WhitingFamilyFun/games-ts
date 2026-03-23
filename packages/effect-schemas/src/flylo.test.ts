import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { FlyloEvent, FlyloGame, GameCard } from "./flylo.js"
import type { PlayerId } from "./common.js"

describe("FlyloEvent discriminated union", () => {
  it("decodes draw event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "draw", fromDiscard: true })
    expect(e.kind).toBe("draw")
    if (e.kind === "draw") expect(e.fromDiscard).toBe(true)
  })

  it("decodes flip event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "flip", index: 3 })
    expect(e.kind).toBe("flip")
  })

  it("decodes discard event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "discard" })
    expect(e.kind).toBe("discard")
  })

  it("decodes replace event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "replace", index: 5 })
    expect(e.kind).toBe("replace")
  })

  it("rejects unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(FlyloEvent)({ kind: "nope" })).toThrow()
  })
})

describe("GameCard", () => {
  it("defaults flipped to false", () => {
    const c = Schema.decodeUnknownSync(GameCard)({ number: "p5" })
    expect(c.flipped).toBe(false)
  })

  it("round-trips", () => {
    const c = Schema.decodeUnknownSync(GameCard)({ number: "m2", flipped: true })
    const json = Schema.encodeSync(GameCard)(c)
    const c2 = Schema.decodeUnknownSync(GameCard)(json)
    expect(c2).toEqual(c)
  })
})

describe("FlyloGame has GenericFields", () => {
  it("includes status, round, players, rewards as top-level fields", () => {
    const game = Schema.decodeUnknownSync(FlyloGame)({
      type: "Flylo",
      status: "started",
      round: 1,
      players: [{ id: "p1", name: "Alice" }],
      playerIds: ["p1"],
      flyloPlayers: [{ deck: { cards: [] }, card: null }],
      discardPile: { cards: [] },
      drawPile: { cards: [] },
      currentPlayerIndex: 0,
    })
    // Generic fields are directly on the object
    expect(game.status).toBe("started")
    expect(game.round).toBe(1)
    expect(game.players).toHaveLength(1)
    expect(game.readyPlayers).toEqual([])
    expect(game.rewards).toEqual([])
    // Game-specific fields also directly on the object
    expect(game.type).toBe("Flylo")
    expect(game.flyloPlayers).toHaveLength(1)
  })
})
