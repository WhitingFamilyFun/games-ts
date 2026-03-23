import { Effect, Exit } from "effect"
import type { FlyloGame, GameConfig, Player, PlayerId } from "@games/effect-schemas"
import { InvalidMove, NotYourTurn } from "@games/effect-schemas"
import { describe, expect, it } from "vitest"
import { flyloFunctions } from "./logic.js"
import {
  addCard,
  allCards,
  CARD_NUMS,
  CARD_QUANTITIES,
  drawFromDeck,
  emptyDeck,
  shuffleDeck,
} from "./deck.js"

const makeConfig = (seed?: number): GameConfig => ({
  gameType: "Flylo",
  adminID: "" as PlayerId,
  options: seed !== undefined ? { randomSeed: seed } : {},
  rounds: 1,
  minPlayers: 2,
  maxPlayers: 20,
})

const makePlayers = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}` as PlayerId,
    name: `Player ${i}`,
  }))

// ---------------------------------------------------------------------------
describe("Deck", () => {
  it("allCards produces 150 cards", () => {
    expect(allCards().cards.length).toBe(150)
  })

  it("card quantities are correct", () => {
    const deck = allCards()
    for (const num of CARD_NUMS) {
      const count = deck.cards.filter(c => c.number === num).length
      expect(count, `quantity for ${num}`).toBe(CARD_QUANTITIES[num])
    }
  })

  it("drawFromDeck reduces length by 1 and returns top card", () => {
    const deck = allCards()
    const { card, deck: after } = drawFromDeck(deck)
    expect(after.cards.length).toBe(149)
    expect(card.number).toBe(deck.cards[0]!.number)
    expect(card.flipped).toBe(true)
  })

  it("addCard increases length by 1", () => {
    const deck = allCards()
    const after = addCard(deck, { number: "m1", flipped: false })
    expect(after.cards.length).toBe(151)
  })

  it("emptyDeck has 0 cards", () => {
    expect(emptyDeck.cards.length).toBe(0)
  })

  it("shuffleDeck with same seed produces same order", () => {
    const a = shuffleDeck(allCards(), 42)
    const b = shuffleDeck(allCards(), 42)
    expect(a.cards.map(c => c.number)).toEqual(b.cards.map(c => c.number))
  })

  it("shuffleDeck with different seeds produces different orders", () => {
    const a = shuffleDeck(allCards(), 1)
    const b = shuffleDeck(allCards(), 99999)
    const same = a.cards.every((c, i) => c.number === b.cards[i]?.number)
    expect(same).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe("FlyloGame.initialState", () => {
  it("creates valid state with generic fields", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(1), makePlayers(3))
    )
    // Generic fields
    expect(g.status).toBe("started")
    expect(g.round).toBe(1)
    expect(g.players).toHaveLength(3)
    expect(g.rewards).toEqual([0, 0, 0])
    expect(g.readyPlayers).toEqual([])
    // Game-specific fields
    expect(g.flyloPlayers).toHaveLength(3)
    expect(g.type).toBe("Flylo")
    expect(g.playerIds).toHaveLength(3)
  })

  it("discardPile starts with exactly 1 card", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(1), makePlayers(3))
    )
    expect(g.discardPile.cards.length).toBe(1)
    expect(g.discardPile.cards[0]!.flipped).toBe(true)
  })

  it("drawPile has correct number of remaining cards (150 - n*12 - 1)", async () => {
    const players = makePlayers(4)
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(2), players)
    )
    expect(g.drawPile.cards.length).toBe(150 - 4 * 12 - 1)
  })

  it("each player starts with exactly 12 cards", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(3), makePlayers(3))
    )
    for (const p of g.flyloPlayers) {
      expect(p.deck.cards.length).toBe(12)
    }
  })

  it("is deterministic with the same seed", async () => {
    const g1 = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(7), makePlayers(2))
    )
    const g2 = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(7), makePlayers(2))
    )
    expect(g1.drawPile.cards.map(c => c.number)).toEqual(
      g2.drawPile.cards.map(c => c.number)
    )
  })

  it("different seeds produce different states", async () => {
    const g1 = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(7), makePlayers(2))
    )
    const g2 = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(8), makePlayers(2))
    )
    const same = g1.drawPile.cards.every(
      (c, i) => c.number === g2.drawPile.cards[i]?.number
    )
    expect(same).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Helper: put a drawn card into a player's hand (for tests that need it)
function withDrawnCard(g: FlyloGame, playerIdx: number, fromDiscard = false): FlyloGame {
  const player = g.flyloPlayers[playerIdx]!
  const { card, deck: newDraw } = fromDiscard
    ? {
        card: g.discardPile.cards[g.discardPile.cards.length - 1]!,
        deck: { cards: g.discardPile.cards.slice(0, -1) },
      }
    : drawFromDeck(g.drawPile)
  const newPlayers = g.flyloPlayers.map((p, i) =>
    i === playerIdx ? { ...p, card: { ...card, flipped: true }, fromDiscard } : p
  )
  if (fromDiscard) {
    return {
      ...g,
      flyloPlayers: newPlayers,
      discardPile: { cards: g.discardPile.cards.slice(0, -1) },
    }
  }
  return { ...g, flyloPlayers: newPlayers, drawPile: newDraw }
}

// Helper: force all players to be "ready to start" (flip 2 cards each)
function makeAllReady(g: FlyloGame): FlyloGame {
  const newPlayers = g.flyloPlayers.map(p => ({
    ...p,
    deck: {
      cards: p.deck.cards.map((c, i) => (i < 2 ? { ...c, flipped: true } : c)),
    },
  }))
  return { ...g, flyloPlayers: newPlayers }
}

// ---------------------------------------------------------------------------
describe("Flylo turn - flip", () => {
  it("flips a face-down card", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const result = await Effect.runPromise(
      flyloFunctions.next(g, makeConfig(5), g.playerIds[g.currentPlayerIndex]!, {
        kind: "flip",
        index: 0,
      })
    )
    expect(
      result.flyloPlayers[g.currentPlayerIndex]!.deck.cards[0]!.flipped
    ).toBe(true)
  })

  it("errors when flipping an already-flipped card", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const r1 = await Effect.runPromise(
      flyloFunctions.next(g, makeConfig(5), g.playerIds[g.currentPlayerIndex]!, {
        kind: "flip",
        index: 0,
      })
    )
    const exit = await Effect.runPromiseExit(
      flyloFunctions.next(
        r1,
        makeConfig(5),
        r1.playerIds[r1.currentPlayerIndex]!,
        { kind: "flip", index: 0 }
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      // Extract the error from the cause
      const error = cause._tag === "Fail" ? cause.error : null
      expect(error).toBeInstanceOf(InvalidMove)
      if (error instanceof InvalidMove) {
        expect(error.message).toContain("already flipped")
      }
    }
  })
})

describe("Flylo turn - draw from deck", () => {
  it("sets the held card and reduces drawPile by 1", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const beforeLen = base.drawPile.cards.length
    const result = await Effect.runPromise(
      flyloFunctions.next(
        base,
        makeConfig(5),
        base.playerIds[base.currentPlayerIndex]!,
        { kind: "draw", fromDiscard: false }
      )
    )
    expect(
      result.flyloPlayers[base.currentPlayerIndex]!.card
    ).not.toBeNull()
    expect(result.drawPile.cards.length).toBe(beforeLen - 1)
  })
})

describe("Flylo turn - draw from discard", () => {
  it("sets held card from top of discard, discard shrinks by 1", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const beforeLen = base.discardPile.cards.length
    const topCard = base.discardPile.cards[base.discardPile.cards.length - 1]!
    const result = await Effect.runPromise(
      flyloFunctions.next(
        base,
        makeConfig(5),
        base.playerIds[base.currentPlayerIndex]!,
        { kind: "draw", fromDiscard: true }
      )
    )
    expect(
      result.flyloPlayers[base.currentPlayerIndex]!.card?.number
    ).toBe(topCard.number)
    expect(result.discardPile.cards.length).toBe(beforeLen - 1)
  })
})

describe("Flylo turn - discard", () => {
  it("places held card onto discard and sets discardToFlip", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const withCard = withDrawnCard(base, base.currentPlayerIndex, false)
    const beforeDiscardLen = withCard.discardPile.cards.length
    const result = await Effect.runPromise(
      flyloFunctions.next(
        withCard,
        makeConfig(5),
        withCard.playerIds[withCard.currentPlayerIndex]!,
        { kind: "discard" }
      )
    )
    expect(
      result.flyloPlayers[withCard.currentPlayerIndex]!.card
    ).toBeNull()
    expect(result.discardPile.cards.length).toBe(beforeDiscardLen + 1)
    expect(
      result.flyloPlayers[withCard.currentPlayerIndex]!.discardToFlip
    ).toBe(true)
  })

  it("errors when player has no held card", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const exit = await Effect.runPromiseExit(
      flyloFunctions.next(
        base,
        makeConfig(5),
        base.playerIds[base.currentPlayerIndex]!,
        { kind: "discard" }
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("errors when held card was drawn from discard", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const withCard = withDrawnCard(base, base.currentPlayerIndex, true)
    const exit = await Effect.runPromiseExit(
      flyloFunctions.next(
        withCard,
        makeConfig(5),
        withCard.playerIds[withCard.currentPlayerIndex]!,
        { kind: "discard" }
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect(error).toBeInstanceOf(InvalidMove)
      if (error instanceof InvalidMove) {
        expect(error.message).toContain("discard pile")
      }
    }
  })
})

describe("Flylo turn - replace", () => {
  it("swaps held card into hand, replaced card goes to discard", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const withCard = withDrawnCard(base, base.currentPlayerIndex, false)
    const heldCard = withCard.flyloPlayers[withCard.currentPlayerIndex]!.card!
    const replacedCard =
      withCard.flyloPlayers[withCard.currentPlayerIndex]!.deck.cards[3]!
    const beforeDiscardLen = withCard.discardPile.cards.length
    const result = await Effect.runPromise(
      flyloFunctions.next(
        withCard,
        makeConfig(5),
        withCard.playerIds[withCard.currentPlayerIndex]!,
        { kind: "replace", index: 3 }
      )
    )
    const player = result.flyloPlayers[withCard.currentPlayerIndex]!
    expect(player.card).toBeNull()
    expect(player.deck.cards[3]!.number).toBe(heldCard.number)
    expect(result.discardPile.cards.length).toBe(beforeDiscardLen + 1)
    const lastDiscard =
      result.discardPile.cards[result.discardPile.cards.length - 1]!
    expect(lastDiscard.number).toBe(replacedCard.number)
  })

  it("errors when no held card", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const exit = await Effect.runPromiseExit(
      flyloFunctions.next(
        base,
        makeConfig(5),
        base.playerIds[base.currentPlayerIndex]!,
        { kind: "replace", index: 0 }
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("Flylo turn - wrong player", () => {
  it("errors with NotYourTurn when a non-current player acts", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(5), makePlayers(2))
    )
    const base = makeAllReady(g)
    const wrongPlayer =
      base.currentPlayerIndex === 0
        ? ("p1" as PlayerId)
        : ("p0" as PlayerId)
    const exit = await Effect.runPromiseExit(
      flyloFunctions.next(base, makeConfig(5), wrongPlayer, {
        kind: "draw",
        fromDiscard: false,
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect(error).toBeInstanceOf(NotYourTurn)
    }
  })
})

describe("Flylo round/game lifecycle", () => {
  it("isRoundOver returns false on fresh game", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(1), makePlayers(2))
    )
    expect(flyloFunctions.isRoundOver(g)).toBe(false)
  })

  it("isGameOver returns false on fresh game", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(1), makePlayers(2))
    )
    expect(flyloFunctions.isGameOver(g, makeConfig(1))).toBe(false)
  })

  it("nextRound deals new cards", async () => {
    const g = await Effect.runPromise(
      flyloFunctions.initialState(makeConfig(1), makePlayers(2))
    )
    const r2 = await Effect.runPromise(
      flyloFunctions.nextRound(g, makeConfig(1))
    )
    expect(r2.flyloPlayers[0]!.deck.cards.length).toBe(12)
    expect(r2.flyloPlayers[1]!.deck.cards.length).toBe(12)
    expect(r2.discardPile.cards.length).toBe(1)
  })
})
