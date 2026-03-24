import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import {
  FaceCard,
  FaceSuit,
  FaceValue,
  GlumEvent,
  GlumGame,
  GlumPlaySetEvent,
  GlumPassEvent,
  GlumGiveEvent,
  GlumSet,
  GlumPile,
  GlumPlayer,
  GlumDesignation,
} from "./glum.js"

describe("FaceSuit", () => {
  it("accepts valid suits", () => {
    for (const suit of ["clubs", "spades", "hearts", "diamonds"] as const) {
      const s = Schema.decodeUnknownSync(FaceSuit)(suit)
      expect(s).toBe(suit)
    }
  })

  it("rejects invalid suit", () => {
    expect(() => Schema.decodeUnknownSync(FaceSuit)("joker")).toThrow()
  })
})

describe("FaceValue", () => {
  it("accepts valid values", () => {
    for (const value of ["ace", "two", "king", "queen", "jack", "ten"] as const) {
      const v = Schema.decodeUnknownSync(FaceValue)(value)
      expect(v).toBe(value)
    }
  })

  it("rejects invalid value", () => {
    expect(() => Schema.decodeUnknownSync(FaceValue)("fourteen")).toThrow()
  })
})

describe("FaceCard", () => {
  it("decodes a normal card", () => {
    const card = Schema.decodeUnknownSync(FaceCard)({ kind: "normal", suit: "hearts", value: "ace" })
    expect(card.kind).toBe("normal")
    if (card.kind === "normal") {
      expect(card.suit).toBe("hearts")
      expect(card.value).toBe("ace")
    }
  })

  it("decodes a joker", () => {
    const card = Schema.decodeUnknownSync(FaceCard)({ kind: "joker" })
    expect(card.kind).toBe("joker")
  })

  it("rejects unknown kind", () => {
    expect(() => Schema.decodeUnknownSync(FaceCard)({ kind: "wild" })).toThrow()
  })

  it("round-trips a normal card", () => {
    const raw = { kind: "normal" as const, suit: "spades" as const, value: "king" as const }
    const decoded = Schema.decodeUnknownSync(FaceCard)(raw)
    const encoded = Schema.encodeSync(FaceCard)(decoded)
    expect(encoded).toEqual(raw)
  })

  it("round-trips a joker", () => {
    const raw = { kind: "joker" as const }
    const decoded = Schema.decodeUnknownSync(FaceCard)(raw)
    const encoded = Schema.encodeSync(FaceCard)(decoded)
    expect(encoded).toEqual(raw)
  })
})

describe("GlumDesignation", () => {
  it("accepts all valid designations", () => {
    for (const d of ["King", "Queen", "Villager", "Peasant", "Scum"] as const) {
      expect(Schema.decodeUnknownSync(GlumDesignation)(d)).toBe(d)
    }
  })

  it("rejects invalid designation", () => {
    expect(() => Schema.decodeUnknownSync(GlumDesignation)("Jester")).toThrow()
  })
})

describe("GlumSet", () => {
  it("decodes a set with cards and no declaredValue", () => {
    const s = Schema.decodeUnknownSync(GlumSet)({
      cards: [{ kind: "normal", suit: "clubs", value: "five" }],
    })
    expect(s.cards).toHaveLength(1)
    expect(s.declaredValue).toBeNull()
  })

  it("decodes a set with a declared joker value", () => {
    const s = Schema.decodeUnknownSync(GlumSet)({
      cards: [{ kind: "joker" }],
      declaredValue: { kind: "normal", suit: "diamonds", value: "queen" },
    })
    expect(s.declaredValue).not.toBeNull()
    if (s.declaredValue && s.declaredValue.kind === "normal") {
      expect(s.declaredValue.suit).toBe("diamonds")
      expect(s.declaredValue.value).toBe("queen")
    }
  })
})

describe("GlumPile", () => {
  it("decodes an empty pile", () => {
    const pile = Schema.decodeUnknownSync(GlumPile)({ sets: [] })
    expect(pile.sets).toHaveLength(0)
  })

  it("decodes a pile with sets", () => {
    const pile = Schema.decodeUnknownSync(GlumPile)({
      sets: [
        { cards: [{ kind: "normal", suit: "hearts", value: "three" }] },
        { cards: [{ kind: "joker" }] },
      ],
    })
    expect(pile.sets).toHaveLength(2)
  })
})

describe("GlumPlayer", () => {
  it("defaults passed to false", () => {
    const player = Schema.decodeUnknownSync(GlumPlayer)({ deck: [] })
    expect(player.passed).toBe(false)
  })

  it("decodes a player with cards and passed=true", () => {
    const player = Schema.decodeUnknownSync(GlumPlayer)({
      deck: [{ kind: "normal", suit: "clubs", value: "ace" }],
      passed: true,
    })
    expect(player.deck).toHaveLength(1)
    expect(player.passed).toBe(true)
  })
})

describe("GlumEvent discriminated union", () => {
  it("decodes playSet event", () => {
    const e = Schema.decodeUnknownSync(GlumEvent)({
      kind: "glum_playSet",
      glumSet: { cards: [{ kind: "normal", suit: "spades", value: "ten" }] },
    })
    expect(e.kind).toBe("glum_playSet")
    if (e.kind === "glum_playSet") {
      expect(e.glumSet.cards).toHaveLength(1)
    }
  })

  it("decodes pass event", () => {
    const e = Schema.decodeUnknownSync(GlumEvent)({ kind: "glum_pass" })
    expect(e.kind).toBe("glum_pass")
  })

  it("decodes give event", () => {
    const e = Schema.decodeUnknownSync(GlumEvent)({
      kind: "glum_give",
      toPlayer: "p2",
      cards: [{ kind: "normal", suit: "hearts", value: "two" }],
    })
    expect(e.kind).toBe("glum_give")
    if (e.kind === "glum_give") {
      expect(e.toPlayer).toBe("p2")
      expect(e.cards).toHaveLength(1)
    }
  })

  it("rejects unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(GlumEvent)({ kind: "unknown" })).toThrow()
  })

  it("round-trips playSet event", () => {
    const raw = {
      kind: "glum_playSet" as const,
      glumSet: {
        cards: [{ kind: "normal" as const, suit: "diamonds" as const, value: "jack" as const }],
        declaredValue: null,
      },
    }
    const decoded = Schema.decodeUnknownSync(GlumPlaySetEvent)(raw)
    const encoded = Schema.encodeSync(GlumPlaySetEvent)(decoded)
    expect((encoded as typeof decoded).kind).toBe("glum_playSet")
  })

  it("round-trips pass event", () => {
    const raw = { kind: "glum_pass" as const }
    const decoded = Schema.decodeUnknownSync(GlumPassEvent)(raw)
    const encoded = Schema.encodeSync(GlumPassEvent)(decoded)
    expect(encoded).toEqual(raw)
  })

  it("round-trips give event", () => {
    const raw = {
      kind: "glum_give" as const,
      toPlayer: "p3" as const,
      cards: [{ kind: "joker" as const }],
    }
    const decoded = Schema.decodeUnknownSync(GlumGiveEvent)(raw)
    const encoded = Schema.encodeSync(GlumGiveEvent)(decoded)
    expect((encoded as typeof decoded).kind).toBe("glum_give")
    expect((encoded as typeof decoded).toPlayer).toBe("p3")
  })
})

describe("GlumGame has GenericFields", () => {
  const baseGame = {
    type: "Glum",
    status: "started",
    round: 1,
    players: [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
    playerIds: ["p1", "p2"],
    glumPlayers: [
      { deck: [{ kind: "normal", suit: "hearts", value: "ace" }] },
      { deck: [{ kind: "joker" }] },
    ],
    pile: { sets: [] },
    currentPlayerIndex: 0,
  }

  it("decodes a full game with GenericFields", () => {
    const game = Schema.decodeUnknownSync(GlumGame)(baseGame)
    expect(game.status).toBe("started")
    expect(game.round).toBe(1)
    expect(game.type).toBe("Glum")
    expect(game.players).toHaveLength(2)
    expect(game.glumPlayers).toHaveLength(2)
    expect(game.currentPlayerIndex).toBe(0)
  })

  it("applies defaults for optional fields", () => {
    const game = Schema.decodeUnknownSync(GlumGame)(baseGame)
    expect(game.outIndex).toEqual([])
    expect(game.finishedSetup).toEqual([])
    expect(game.readyPlayers).toEqual([])
    expect(game.rewards).toEqual([])
    // GlumPlayer.passed defaults to false
    expect(game.glumPlayers[0].passed).toBe(false)
  })

  it("decodes with explicit optional fields set", () => {
    const game = Schema.decodeUnknownSync(GlumGame)({
      ...baseGame,
      outIndex: [1],
      finishedSetup: [0, 1],
    })
    expect(game.outIndex).toEqual([1])
    expect(game.finishedSetup).toEqual([0, 1])
  })

  it("round-trips a game", () => {
    const decoded = Schema.decodeUnknownSync(GlumGame)(baseGame)
    const encoded = Schema.encodeSync(GlumGame)(decoded)
    expect((encoded as typeof decoded).type).toBe("Glum")
    expect((encoded as typeof decoded).status).toBe("started")
    expect((encoded as typeof decoded).currentPlayerIndex).toBe(0)
  })
})
