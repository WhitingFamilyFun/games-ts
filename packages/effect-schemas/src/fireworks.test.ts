import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import {
  FireworksEvent,
  FireworksGame,
  FireworksCard,
  FireworksDeck,
  FireworksPlayer,
  FireworkColor,
  FireworksPlayEvent,
  FireworksDiscardEvent,
  FireworksInfoColorEvent,
  FireworksInfoNumberEvent,
  FireworksSawHintEvent,
} from "./fireworks.js"

describe("FireworkColor", () => {
  it("accepts valid colors", () => {
    for (const color of ["red", "green", "blue", "white", "yellow"] as const) {
      const c = Schema.decodeUnknownSync(FireworkColor)(color)
      expect(c).toBe(color)
    }
  })

  it("rejects invalid color", () => {
    expect(() => Schema.decodeUnknownSync(FireworkColor)("purple")).toThrow()
  })
})

describe("FireworksCard", () => {
  it("decodes a valid card", () => {
    const card = Schema.decodeUnknownSync(FireworksCard)({ color: "red", number: 3 })
    expect(card.color).toBe("red")
    expect(card.number).toBe(3)
  })

  it("round-trips a card", () => {
    const raw = { color: "blue", number: 5 }
    const decoded = Schema.decodeUnknownSync(FireworksCard)(raw)
    const encoded = Schema.encodeSync(FireworksCard)(decoded)
    expect(encoded).toEqual(raw)
  })

  it("rejects card with invalid color", () => {
    expect(() => Schema.decodeUnknownSync(FireworksCard)({ color: "orange", number: 1 })).toThrow()
  })
})

describe("FireworksDeck", () => {
  it("decodes an empty deck", () => {
    const deck = Schema.decodeUnknownSync(FireworksDeck)({ cards: [] })
    expect(deck.cards).toHaveLength(0)
  })

  it("decodes a deck with cards", () => {
    const deck = Schema.decodeUnknownSync(FireworksDeck)({
      cards: [
        { color: "green", number: 1 },
        { color: "yellow", number: 2 },
      ],
    })
    expect(deck.cards).toHaveLength(2)
    expect(deck.cards[0].color).toBe("green")
  })

  it("round-trips a deck", () => {
    const raw = { cards: [{ color: "white", number: 4 }] }
    const decoded = Schema.decodeUnknownSync(FireworksDeck)(raw)
    const encoded = Schema.encodeSync(FireworksDeck)(decoded)
    expect(encoded).toEqual(raw)
  })
})

describe("FireworksEvent discriminated union", () => {
  it("decodes play event", () => {
    const e = Schema.decodeUnknownSync(FireworksEvent)({ kind: "play", card: { color: "red", number: 1 } })
    expect(e.kind).toBe("play")
    if (e.kind === "play") {
      expect(e.card.color).toBe("red")
      expect(e.card.number).toBe(1)
    }
  })

  it("decodes discard event", () => {
    const e = Schema.decodeUnknownSync(FireworksEvent)({ kind: "discard", card: { color: "blue", number: 3 } })
    expect(e.kind).toBe("discard")
    if (e.kind === "discard") {
      expect(e.card.color).toBe("blue")
    }
  })

  it("decodes infoColor event", () => {
    const e = Schema.decodeUnknownSync(FireworksEvent)({ kind: "infoColor", color: "green", hintFor: "p2" })
    expect(e.kind).toBe("infoColor")
    if (e.kind === "infoColor") {
      expect(e.color).toBe("green")
      expect(e.hintFor).toBe("p2")
    }
  })

  it("decodes infoNumber event", () => {
    const e = Schema.decodeUnknownSync(FireworksEvent)({ kind: "infoNumber", number: 4, hintFor: "p3" })
    expect(e.kind).toBe("infoNumber")
    if (e.kind === "infoNumber") {
      expect(e.number).toBe(4)
      expect(e.hintFor).toBe("p3")
    }
  })

  it("decodes sawHint event", () => {
    const e = Schema.decodeUnknownSync(FireworksEvent)({ kind: "sawHint" })
    expect(e.kind).toBe("sawHint")
  })

  it("rejects unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(FireworksEvent)({ kind: "unknown" })).toThrow()
  })

  it("round-trips play event", () => {
    const raw = { kind: "play" as const, card: { color: "yellow" as const, number: 2 } }
    const decoded = Schema.decodeUnknownSync(FireworksPlayEvent)(raw)
    const encoded = Schema.encodeSync(FireworksPlayEvent)(decoded)
    expect(encoded).toEqual(raw)
  })

  it("round-trips infoColor event", () => {
    const raw = { kind: "infoColor" as const, color: "white" as const, hintFor: "p1" }
    const decoded = Schema.decodeUnknownSync(FireworksInfoColorEvent)(raw)
    const encoded = Schema.encodeSync(FireworksInfoColorEvent)(decoded)
    expect(encoded).toEqual(raw)
  })
})

describe("FireworksGame has GenericFields", () => {
  const baseGame = {
    type: "Fireworks",
    status: "started",
    round: 1,
    players: [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
    playerIds: ["p1", "p2"],
    fireworksPlayers: [
      { cards: [{ color: "red", number: 1 }, { color: "green", number: 2 }] },
      { cards: [{ color: "blue", number: 3 }, { color: "white", number: 4 }] },
    ],
    fireworks: { red: 0, green: 0, blue: 0, white: 0, yellow: 0 },
    drawPile: { cards: [{ color: "yellow", number: 5 }] },
    discardPile: { cards: [] },
    currentPlayerIndex: 0,
    numClocks: 8,
    numFuses: 3,
  }

  it("decodes a full game with GenericFields", () => {
    const game = Schema.decodeUnknownSync(FireworksGame)(baseGame)
    expect(game.status).toBe("started")
    expect(game.round).toBe(1)
    expect(game.type).toBe("Fireworks")
    expect(game.numClocks).toBe(8)
    expect(game.numFuses).toBe(3)
    expect(game.players).toHaveLength(2)
  })

  it("applies defaults for optional fields", () => {
    const game = Schema.decodeUnknownSync(FireworksGame)(baseGame)
    expect(game.nextPlayerIndex).toBeNull()
    expect(game.playerOut).toBeNull()
    expect(game.hintForPlayer).toBeNull()
    expect(game.showColor).toBeNull()
    expect(game.showNumber).toBeNull()
    expect(game.readyPlayers).toEqual([])
    expect(game.rewards).toEqual([])
  })

  it("decodes with explicit optional fields set", () => {
    const game = Schema.decodeUnknownSync(FireworksGame)({
      ...baseGame,
      nextPlayerIndex: 1,
      playerOut: 0,
      hintForPlayer: "p1",
      showColor: "red",
      showNumber: 3,
    })
    expect(game.nextPlayerIndex).toBe(1)
    expect(game.playerOut).toBe(0)
    expect(game.hintForPlayer).toBe("p1")
    expect(game.showColor).toBe("red")
    expect(game.showNumber).toBe(3)
  })

  it("round-trips a game", () => {
    const decoded = Schema.decodeUnknownSync(FireworksGame)(baseGame)
    const encoded = Schema.encodeSync(FireworksGame)(decoded)
    // All fields present in the raw input should survive the round-trip
    expect((encoded as typeof decoded).type).toBe("Fireworks")
    expect((encoded as typeof decoded).status).toBe("started")
    expect((encoded as typeof decoded).numClocks).toBe(8)
  })
})
