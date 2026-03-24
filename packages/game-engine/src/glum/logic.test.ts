import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { glumFunctions, isRoundOverGlum, glumScore, cardValue } from "./logic.js"
import type { GlumGame, GlumEvent, GlumSet, FaceCard, PlayerId, GameConfig, Player } from "@games/effect-schemas"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}` as PlayerId,
    name: `Player ${i}`,
  }))
}

function makeConfig(seed = 42, rounds = 4): GameConfig {
  return {
    gameType: "Glum",
    adminID: "p0" as PlayerId,
    rounds,
    minPlayers: 2,
    maxPlayers: 10,
    options: { randomSeed: seed, rounds },
  }
}

function initGame(playerCount = 3, seed = 42): GlumGame {
  const players = makePlayers(playerCount)
  const config = makeConfig(seed)
  return Effect.runSync(glumFunctions.initialState(config, players))
}

function applyEvent(state: GlumGame, playerId: string, event: GlumEvent): GlumGame {
  const config = makeConfig()
  return Effect.runSync(glumFunctions.next(state, config, playerId as PlayerId, event))
}

function applyEventEither(state: GlumGame, playerId: string, event: GlumEvent) {
  const config = makeConfig()
  return Effect.runSyncExit(glumFunctions.next(state, config, playerId as PlayerId, event))
}

/** Make a normal face card */
function card(value: FaceCard extends infer T ? T extends { kind: "normal" } ? T["value"] : never : never, suit: "clubs" | "spades" | "hearts" | "diamonds" = "clubs"): FaceCard {
  return { kind: "normal", suit, value }
}

function joker(): FaceCard {
  return { kind: "joker" }
}

/** Make a GlumSet of normal cards */
function makeSet(cards: FaceCard[], declaredValue?: FaceCard | null): GlumSet {
  return { cards, declaredValue: declaredValue ?? null }
}

/**
 * Create a game state with controlled hands for testing.
 * Hands is an array of arrays of FaceCards, one per player.
 */
function gameWithHands(hands: FaceCard[][], currentPlayerIndex = 0, seed = 42): GlumGame {
  const players = makePlayers(hands.length)
  const config = makeConfig(seed)
  const base = Effect.runSync(glumFunctions.initialState(config, players))
  return {
    ...base,
    glumPlayers: hands.map(deck => ({ deck, passed: false })),
    currentPlayerIndex,
    pile: { sets: [] },
    outIndex: [],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Glum initialState", () => {
  it("creates correct number of players", () => {
    const game = initGame(3)
    expect(game.glumPlayers).toHaveLength(3)
    expect(game.playerIds).toHaveLength(3)
  })

  it("deals cards evenly among players", () => {
    const game = initGame(3)
    const handSizes = game.glumPlayers.map(p => p.deck.length)
    // All hands should be the same size
    expect(new Set(handSizes).size).toBe(1)
    // 54 cards / 3 players = 18 each
    expect(handSizes[0]).toBe(18)
  })

  it("uses 2 decks for 5+ players", () => {
    const game = initGame(5)
    // 108 cards / 5 players = 21 each (with 3 leftover)
    const totalCards = game.glumPlayers.reduce((s, p) => s + p.deck.length, 0)
    expect(totalCards).toBeLessThanOrEqual(108)
    expect(totalCards).toBeGreaterThanOrEqual(100) // at least 100 dealt
  })

  it("starts with empty pile", () => {
    const game = initGame(3)
    expect(game.pile.sets).toHaveLength(0)
  })

  it("starts with no players out", () => {
    const game = initGame(3)
    expect(game.outIndex).toHaveLength(0)
  })

  it("marks all players as finishedSetup", () => {
    const game = initGame(3)
    expect(game.finishedSetup).toHaveLength(3)
    expect(game.finishedSetup).toEqual([0, 1, 2])
  })

  it("starts with currentPlayerIndex 0", () => {
    const game = initGame(3)
    expect(game.currentPlayerIndex).toBe(0)
  })

  it("no player is marked as passed", () => {
    const game = initGame(3)
    for (const p of game.glumPlayers) {
      expect(p.passed).toBe(false)
    }
  })
})

describe("Glum playSet", () => {
  it("plays a valid set and removes cards from hand", () => {
    const hands = [
      [card("seven"), card("seven"), card("three")],
      [card("eight"), card("eight"), card("four")],
      [card("nine"), card("nine"), card("five")],
    ]
    const game = gameWithHands(hands)

    const next = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })

    // Cards removed from hand
    expect(next.glumPlayers[0]!.deck).toHaveLength(1)
    // Set added to pile
    expect(next.pile.sets).toHaveLength(1)
    expect(next.pile.sets[0]!.cards).toHaveLength(2)
    // Turn advances to p1
    expect(next.currentPlayerIndex).toBe(1)
  })

  it("rejects a set with wrong size vs pile", () => {
    const hands = [
      [card("seven"), card("seven"), card("three")],
      [card("eight"), card("eight"), card("eight")],
      [card("nine"), card("nine"), card("five")],
    ]
    let game = gameWithHands(hands)

    // p0 plays a pair
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })

    // p1 tries to play three cards (wrong size)
    const exit = applyEventEither(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("eight"), card("eight"), card("eight")]),
    })
    expect(exit._tag).toBe("Failure")
  })

  it("rejects a set with lower value than pile top", () => {
    const hands = [
      [card("eight"), card("eight"), card("three")],
      [card("seven"), card("seven"), card("four")],
      [card("nine"), card("nine"), card("five")],
    ]
    let game = gameWithHands(hands)

    // p0 plays pair of eights
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("eight"), card("eight")]),
    })

    // p1 tries to play pair of sevens (lower)
    const exit = applyEventEither(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })
    expect(exit._tag).toBe("Failure")
  })

  it("rejects a set with equal value to pile top", () => {
    const hands = [
      [card("eight"), card("eight"), card("three")],
      [card("eight", "hearts"), card("eight", "hearts"), card("four")],
      [card("nine"), card("nine"), card("five")],
    ]
    let game = gameWithHands(hands)

    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("eight"), card("eight")]),
    })

    const exit = applyEventEither(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("eight", "hearts"), card("eight", "hearts")]),
    })
    expect(exit._tag).toBe("Failure")
  })

  it("rejects playing cards not in hand", () => {
    const hands = [
      [card("seven"), card("three")],
      [card("eight"), card("four")],
      [card("nine"), card("five")],
    ]
    const game = gameWithHands(hands)

    const exit = applyEventEither(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("ace"), card("ace")]),
    })
    expect(exit._tag).toBe("Failure")
  })

  it("rejects an invalid set (mixed values)", () => {
    const hands = [
      [card("seven"), card("eight"), card("three")],
      [card("eight"), card("four"), card("four")],
      [card("nine"), card("five"), card("five")],
    ]
    const game = gameWithHands(hands)

    const exit = applyEventEither(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("eight")]),
    })
    expect(exit._tag).toBe("Failure")
  })

  it("allows jokers as wild cards in a set", () => {
    const hands = [
      [card("seven"), joker(), card("three")],
      [card("eight"), card("eight"), card("four")],
      [card("nine"), card("nine"), card("five")],
    ]
    const game = gameWithHands(hands)

    const next = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), joker()]),
    })

    expect(next.glumPlayers[0]!.deck).toHaveLength(1)
    expect(next.pile.sets).toHaveLength(1)
  })

  it("allows all-joker set with declaredValue", () => {
    const hands = [
      [joker(), joker(), card("three")],
      [card("eight"), card("eight"), card("four")],
      [card("nine"), card("nine"), card("five")],
    ]
    const game = gameWithHands(hands)

    const next = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([joker(), joker()], card("five")),
    })

    expect(next.glumPlayers[0]!.deck).toHaveLength(1)
    expect(next.pile.sets).toHaveLength(1)
  })

  it("player goes out when hand becomes empty", () => {
    const hands = [
      [card("seven"), card("seven")],
      [card("eight"), card("eight"), card("four")],
      [card("nine"), card("nine"), card("five")],
    ]
    const game = gameWithHands(hands)

    const next = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })

    expect(next.glumPlayers[0]!.deck).toHaveLength(0)
    expect(next.outIndex).toContain(0)
  })
})

describe("Glum pass", () => {
  it("marks player as passed and advances turn", () => {
    const hands = [
      [card("seven"), card("seven"), card("three")],
      [card("four"), card("four"), card("two")],
      [card("nine"), card("nine"), card("five")],
    ]
    let game = gameWithHands(hands)

    // p0 plays a pair
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })

    // p1 passes
    const next = applyEvent(game, "p1", { kind: "pass" })
    expect(next.glumPlayers[1]!.passed).toBe(true)
    // Turn should advance to p2
    expect(next.currentPlayerIndex).toBe(2)
  })

  it("cannot pass on an empty pile", () => {
    const game = initGame(3)
    const exit = applyEventEither(game, "p0", { kind: "pass" })
    expect(exit._tag).toBe("Failure")
  })
})

describe("Glum play round reset", () => {
  it("resets when all other players pass", () => {
    const hands = [
      [card("seven"), card("seven"), card("three"), card("two")],
      [card("four"), card("four"), card("two"), card("two")],
      [card("three"), card("three"), card("five"), card("five")],
    ]
    let game = gameWithHands(hands)

    // p0 plays a pair of sevens
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })

    // p1 passes
    game = applyEvent(game, "p1", { kind: "pass" })

    // p2 passes — now only p0 is active, should reset
    game = applyEvent(game, "p2", { kind: "pass" })

    // Pile should be cleared
    expect(game.pile.sets).toHaveLength(0)
    // All passed flags reset
    for (const p of game.glumPlayers) {
      expect(p.passed).toBe(false)
    }
    // p0 should lead (they won the round)
    expect(game.currentPlayerIndex).toBe(0)
  })

  it("resets when all others are out or passed", () => {
    const hands = [
      [card("seven"), card("seven")], // will go out
      [card("nine"), card("nine"), card("five")],
      [card("three"), card("three"), card("two")],
      [card("king"), card("king"), card("six")],
    ]
    let game = gameWithHands(hands)

    // p0 plays pair of sevens and goes out
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })
    expect(game.outIndex).toContain(0)

    // p1 plays pair of nines
    game = applyEvent(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("nine"), card("nine")]),
    })

    // p2 passes
    game = applyEvent(game, "p2", { kind: "pass" })

    // p3 passes — p0 is out, p2 & p3 passed, only p1 active → reset
    game = applyEvent(game, "p3", { kind: "pass" })

    expect(game.pile.sets).toHaveLength(0)
    // p1 should lead
    expect(game.currentPlayerIndex).toBe(1)
  })
})

describe("Glum round over", () => {
  it("round is over when 2 or fewer players have cards (3+ player game)", () => {
    const hands = [
      [], // out
      [card("eight")],
      [card("nine")],
    ]
    const game = gameWithHands(hands)
    // Only 2 players have cards → round over
    expect(isRoundOverGlum(game)).toBe(true)
  })

  it("round is not over when 3+ players have cards", () => {
    const hands = [
      [card("seven")],
      [card("eight")],
      [card("nine")],
    ]
    const game = gameWithHands(hands)
    expect(isRoundOverGlum(game)).toBe(false)
  })

  it("round is over when only 1 player has cards", () => {
    const hands = [
      [],
      [],
      [card("nine")],
    ]
    const game = gameWithHands(hands)
    expect(isRoundOverGlum(game)).toBe(true)
  })
})

describe("Glum turn validation", () => {
  it("wrong player move is rejected", () => {
    const game = initGame(3)
    // p1 tries to play on p0's turn
    const exit = applyEventEither(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("seven")]),
    })
    expect(exit._tag).toBe("Failure")
  })

  it("cannot act when round is over", () => {
    const hands = [
      [],
      [card("eight")],
      [card("nine")],
    ]
    const game = { ...gameWithHands(hands), currentPlayerIndex: 1 }

    const exit = applyEventEither(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("eight")]),
    })
    expect(exit._tag).toBe("Failure")
  })
})

describe("Glum scoring", () => {
  it("score is negative count of remaining cards", () => {
    const hands = [
      [],
      [card("eight"), card("nine")],
      [card("five")],
    ]
    const game = gameWithHands(hands)
    const scores = glumScore(game)
    expect(scores[0]).toBe(-0) // -0 since it's -length where length is 0
    expect(scores[1]).toBe(-2)
    expect(scores[2]).toBe(-1)
  })
})

describe("Glum game over", () => {
  it("game is over after all rounds complete", () => {
    const hands = [
      [],
      [card("eight")],
      [card("nine")],
    ]
    let game = gameWithHands(hands)
    game = { ...game, round: 4 }
    const config = makeConfig(42, 4)
    // Round is over (2 or fewer have cards) and round >= totalRounds
    expect(glumFunctions.isGameOver(game, config)).toBe(true)
  })

  it("game is not over if rounds remain", () => {
    const hands = [
      [],
      [card("eight")],
      [card("nine")],
    ]
    let game = gameWithHands(hands)
    game = { ...game, round: 2 }
    const config = makeConfig(42, 4)
    expect(glumFunctions.isGameOver(game, config)).toBe(false)
  })
})

describe("Glum nextRound", () => {
  it("resets the board and increments round", () => {
    const hands = [
      [],
      [card("eight"), card("nine")],
      [card("five")],
    ]
    let game = gameWithHands(hands)
    game = { ...game, outIndex: [0] }
    const config = makeConfig(42)

    const next = Effect.runSync(glumFunctions.nextRound(game, config))
    expect(next.round).toBe(game.round + 1)
    expect(next.pile.sets).toHaveLength(0)
    expect(next.outIndex).toHaveLength(0)
    // All players have cards again
    for (const p of next.glumPlayers) {
      expect(p.deck.length).toBeGreaterThan(0)
      expect(p.passed).toBe(false)
    }
  })

  it("accumulates rewards from previous round", () => {
    const hands = [
      [],
      [card("eight"), card("nine")],
      [card("five")],
    ]
    let game = gameWithHands(hands)
    game = { ...game, rewards: [0, 0, 0] }
    const config = makeConfig(42)

    const next = Effect.runSync(glumFunctions.nextRound(game, config))
    // Rewards: p0 had 0 cards (-0), p1 had 2 (-2), p2 had 1 (-1)
    expect(next.rewards).toEqual([0, -2, -1])
  })
})

describe("Glum cardValue", () => {
  it("returns correct values for face cards", () => {
    expect(cardValue(card("ace"))).toBe(14)
    expect(cardValue(card("king"))).toBe(13)
    expect(cardValue(card("queen"))).toBe(12)
    expect(cardValue(card("jack"))).toBe(11)
    expect(cardValue(card("ten"))).toBe(10)
    expect(cardValue(card("two"))).toBe(2)
  })

  it("returns 100 for joker", () => {
    expect(cardValue(joker())).toBe(100)
  })
})

describe("Glum turn skipping", () => {
  it("skips passed players when advancing turn", () => {
    const hands = [
      [card("seven"), card("seven"), card("three")],
      [card("four"), card("four"), card("two")],
      [card("nine"), card("nine"), card("five")],
      [card("ten"), card("ten"), card("six")],
    ]
    let game = gameWithHands(hands)

    // p0 plays
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })

    // p1 passes
    game = applyEvent(game, "p1", { kind: "pass" })

    // p2 plays higher
    game = applyEvent(game, "p2", {
      kind: "playSet",
      glumSet: makeSet([card("nine"), card("nine")]),
    })

    // Turn should go to p3 (skipping p1 who passed)
    // Actually p3 is next normally after p2
    expect(game.currentPlayerIndex).toBe(3)

    // p3 passes
    game = applyEvent(game, "p3", { kind: "pass" })

    // Turn should skip p1 (passed) and go to p0... but p0 must be checked
    // Actually after p3 passes: p0 is active, p1 passed, p2 active, p3 passed
    // next after p3 should be p0
    expect(game.currentPlayerIndex).toBe(0)
  })

  it("skips out players when advancing turn", () => {
    const hands = [
      [card("seven"), card("seven")], // will go out
      [card("nine"), card("nine"), card("five")],
      [card("ten"), card("ten"), card("six")],
      [card("king"), card("king"), card("ace")],
    ]
    let game = gameWithHands(hands)

    // p0 plays and goes out
    game = applyEvent(game, "p0", {
      kind: "playSet",
      glumSet: makeSet([card("seven"), card("seven")]),
    })
    expect(game.outIndex).toContain(0)

    // p1 plays higher
    game = applyEvent(game, "p1", {
      kind: "playSet",
      glumSet: makeSet([card("nine"), card("nine")]),
    })

    // p2 passes
    game = applyEvent(game, "p2", { kind: "pass" })

    // p3 passes — p0 out, p2 & p3 passed, only p1 active → reset
    game = applyEvent(game, "p3", { kind: "pass" })

    // After reset, p1 leads (p0 is out, so skip p0)
    expect(game.currentPlayerIndex).toBe(1)
  })
})
