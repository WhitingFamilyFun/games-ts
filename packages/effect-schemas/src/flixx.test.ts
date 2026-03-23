import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { FlixxEvent, FlixxGame, FlixxRow, FlixxColor, CurrentPlayerChoice } from "./flixx.js"
import type { PlayerId } from "./common.js"

describe("FlixxEvent discriminated union", () => {
  it("decodes roll event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "roll" })
    expect(e.kind).toBe("roll")
  })

  it("decodes takeRoll event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "takeRoll", color: "red", index: 5 })
    expect(e.kind).toBe("takeRoll")
    if (e.kind === "takeRoll") {
      expect(e.color).toBe("red")
      expect(e.index).toBe(5)
    }
  })

  it("decodes pass event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "pass" })
    expect(e.kind).toBe("pass")
  })

  it("decodes takePenalty event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "takePenalty" })
    expect(e.kind).toBe("takePenalty")
  })

  it("rejects unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(FlixxEvent)({ kind: "nope" })).toThrow()
  })
})

describe("CurrentPlayerChoice", () => {
  it("decodes 'none' variant", () => {
    const c = Schema.decodeUnknownSync(CurrentPlayerChoice)({ kind: "none" })
    expect(c.kind).toBe("none")
  })

  it("decodes 'white' variant with index", () => {
    const c = Schema.decodeUnknownSync(CurrentPlayerChoice)({ kind: "white", index: 7 })
    expect(c.kind).toBe("white")
    if (c.kind === "white") expect(c.index).toBe(7)
  })

  it("decodes 'colored' variant with color and index", () => {
    const c = Schema.decodeUnknownSync(CurrentPlayerChoice)({ kind: "colored", color: "blue", index: 4 })
    expect(c.kind).toBe("colored")
    if (c.kind === "colored") {
      expect(c.color).toBe("blue")
      expect(c.index).toBe(4)
    }
  })

  it("decodes 'both' variant with all fields", () => {
    const c = Schema.decodeUnknownSync(CurrentPlayerChoice)({ kind: "both", whiteIndex: 3, color: "green", colorIndex: 8 })
    expect(c.kind).toBe("both")
    if (c.kind === "both") {
      expect(c.whiteIndex).toBe(3)
      expect(c.color).toBe("green")
      expect(c.colorIndex).toBe(8)
    }
  })
})

describe("FlixxGame has GenericFields", () => {
  it("includes status and round as top-level fields", () => {
    const game = Schema.decodeUnknownSync(FlixxGame)({
      type: "Flixx",
      status: "started",
      round: 1,
      players: [{ id: "p1", name: "Alice" }],
      flixxPlayers: {},
      currentPlayerIndex: 0,
    })
    expect(game.status).toBe("started")
    expect(game.round).toBe(1)
    expect(game.type).toBe("Flixx")
  })
})
