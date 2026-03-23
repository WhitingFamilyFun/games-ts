import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { Player, GameConfig, GameStatus, GenericFields, PlayerId } from "./common.js"

describe("Player schema", () => {
  it("decodes a valid player", () => {
    const result = Schema.decodeUnknownSync(Player)({ id: "p1", name: "Alice" })
    expect(result.id).toBe("p1")
    expect(result.name).toBe("Alice")
  })

  it("defaults name to empty string", () => {
    const result = Schema.decodeUnknownSync(Player)({ id: "p1" })
    expect(result.name).toBe("")
  })

  it("rejects missing id", () => {
    expect(() => Schema.decodeUnknownSync(Player)({ name: "Alice" })).toThrow()
  })

  it("round-trips through JSON", () => {
    const player = Schema.decodeUnknownSync(Player)({ id: "p1", name: "Bob" })
    const encoded = Schema.encodeSync(Player)(player)
    const decoded = Schema.decodeUnknownSync(Player)(encoded)
    expect(decoded).toEqual(player)
  })
})

describe("GameConfig schema", () => {
  it("decodes with defaults", () => {
    const config = Schema.decodeUnknownSync(GameConfig)({ gameType: "Flylo" })
    expect(config.rounds).toBe(1)
    expect(config.minPlayers).toBe(2)
    expect(config.maxPlayers).toBe(20)
    expect(config.options).toEqual({})
  })

  it("rejects invalid game type", () => {
    expect(() => Schema.decodeUnknownSync(GameConfig)({ gameType: "Boggle" })).toThrow()
  })
})

describe("GameStatus schema", () => {
  it("accepts all valid statuses", () => {
    for (const s of ["lobby", "started", "betweenRounds", "finished"]) {
      expect(Schema.decodeUnknownSync(GameStatus)(s)).toBe(s)
    }
  })

  it("rejects invalid status", () => {
    expect(() => Schema.decodeUnknownSync(GameStatus)("paused")).toThrow()
  })
})

describe("GenericFields schema", () => {
  it("decodes with defaults", () => {
    const g = Schema.decodeUnknownSync(GenericFields)({
      status: "started",
      round: 1,
      players: [{ id: "p1", name: "Alice" }],
    })
    expect(g.readyPlayers).toEqual([])
    expect(g.rewards).toEqual([])
  })
})
