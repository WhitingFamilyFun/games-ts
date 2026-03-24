import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { fireworksFunctions, fireworksScore } from "./logic.js"
import type { FireworksGame, FireworksEvent, PlayerId, GameConfig, Player } from "@games/effect-schemas"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}` as PlayerId,
    name: `Player ${i}`,
  }))
}

function makeConfig(seed = 42): GameConfig {
  return {
    gameType: "Fireworks",
    adminID: "p0" as PlayerId,
    rounds: 1,
    minPlayers: 2,
    maxPlayers: 6,
    options: { randomSeed: seed },
  }
}

function initGame(playerCount = 2, seed = 42): FireworksGame {
  const players = makePlayers(playerCount)
  const config = makeConfig(seed)
  return Effect.runSync(fireworksFunctions.initialState(config, players))
}

function applyEvent(state: FireworksGame, playerId: string, event: FireworksEvent): FireworksGame {
  const config = makeConfig()
  return Effect.runSync(fireworksFunctions.next(state, config, playerId as PlayerId, event))
}

function applyEventEither(state: FireworksGame, playerId: string, event: FireworksEvent) {
  const config = makeConfig()
  return Effect.runSyncExit(fireworksFunctions.next(state, config, playerId as PlayerId, event))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Fireworks initialState", () => {
  it("deals correct hand sizes for 2 players", () => {
    const game = initGame(2)
    expect(game.fireworksPlayers).toHaveLength(2)
    expect(game.fireworksPlayers[0]!.cards).toHaveLength(5)
    expect(game.fireworksPlayers[1]!.cards).toHaveLength(5)
    // 50 total - 10 dealt = 40 in draw pile
    expect(game.drawPile.cards).toHaveLength(40)
  })

  it("deals correct hand sizes for 3 players", () => {
    const game = initGame(3)
    expect(game.fireworksPlayers).toHaveLength(3)
    for (const p of game.fireworksPlayers) {
      expect(p.cards).toHaveLength(5)
    }
    // 50 - 15 = 35
    expect(game.drawPile.cards).toHaveLength(35)
  })

  it("deals correct hand sizes for 4 players", () => {
    const game = initGame(4)
    for (const p of game.fireworksPlayers) {
      expect(p.cards).toHaveLength(4)
    }
    // 50 - 16 = 34
    expect(game.drawPile.cards).toHaveLength(34)
  })

  it("deals correct hand sizes for 5 players", () => {
    const game = initGame(5)
    for (const p of game.fireworksPlayers) {
      expect(p.cards).toHaveLength(4)
    }
    // 50 - 20 = 30
    expect(game.drawPile.cards).toHaveLength(30)
  })

  it("starts with 8 clocks and 3 fuses", () => {
    const game = initGame(2)
    expect(game.numClocks).toBe(8)
    expect(game.numFuses).toBe(3)
  })

  it("starts with all fireworks at 0", () => {
    const game = initGame(2)
    for (const color of ["red", "green", "blue", "white", "yellow"] as const) {
      expect(game.fireworks[color]).toBe(0)
    }
  })

  it("starts with empty discard pile", () => {
    const game = initGame(2)
    expect(game.discardPile.cards).toHaveLength(0)
  })

  it("starts with currentPlayerIndex 0", () => {
    const game = initGame(2)
    expect(game.currentPlayerIndex).toBe(0)
  })

  it("total cards in deck + hands = 50", () => {
    const game = initGame(3)
    const totalHand = game.fireworksPlayers.reduce((s, p) => s + p.cards.length, 0)
    expect(totalHand + game.drawPile.cards.length).toBe(50)
  })
})

describe("Fireworks play event", () => {
  it("plays a valid card and increments the firework", () => {
    let game = initGame(2)
    // Find a card that is a 1 (always valid on an empty firework)
    const player0 = game.fireworksPlayers[0]!
    const oneCard = player0.cards.find(c => c.number === 1)
    if (!oneCard) {
      // If no 1 in hand, force one for testing
      game = {
        ...game,
        fireworksPlayers: [
          { cards: [{ color: "red", number: 1 }, ...player0.cards.slice(1)] },
          game.fireworksPlayers[1]!,
        ],
      }
    }
    const cardToPlay = game.fireworksPlayers[0]!.cards.find(c => c.number === 1)!
    const next = applyEvent(game, "p0", { kind: "fw_play", card: cardToPlay })
    expect(next.fireworks[cardToPlay.color]).toBe(1)
    // Turn advances to player 1
    expect(next.currentPlayerIndex).toBe(1)
  })

  it("plays an invalid card and loses a fuse", () => {
    let game = initGame(2)
    // Force a card that won't match (a 3 on an empty firework)
    game = {
      ...game,
      fireworksPlayers: [
        { cards: [{ color: "red", number: 3 }, ...game.fireworksPlayers[0]!.cards.slice(1)] },
        game.fireworksPlayers[1]!,
      ],
    }
    const next = applyEvent(game, "p0", { kind: "fw_play", card: { color: "red", number: 3 } })
    expect(next.numFuses).toBe(2)
    expect(next.fireworks.red).toBe(0)
    // Card should be in discard
    expect(next.discardPile.cards.some(c => c.color === "red" && c.number === 3)).toBe(true)
  })

  it("draws a replacement card after playing", () => {
    let game = initGame(2)
    game = {
      ...game,
      fireworksPlayers: [
        { cards: [{ color: "red", number: 1 }, ...game.fireworksPlayers[0]!.cards.slice(1)] },
        game.fireworksPlayers[1]!,
      ],
    }
    const handSizeBefore = game.fireworksPlayers[0]!.cards.length
    const drawSizeBefore = game.drawPile.cards.length
    const next = applyEvent(game, "p0", { kind: "fw_play", card: { color: "red", number: 1 } })
    // Hand size stays the same (removed one, drew one)
    expect(next.fireworksPlayers[0]!.cards.length).toBe(handSizeBefore)
    expect(next.drawPile.cards.length).toBe(drawSizeBefore - 1)
  })

  it("completing a firework to 5 gains a clock", () => {
    let game = initGame(2)
    game = {
      ...game,
      fireworks: { ...game.fireworks, red: 4 },
      numClocks: 6,
      fireworksPlayers: [
        { cards: [{ color: "red", number: 5 }, ...game.fireworksPlayers[0]!.cards.slice(1)] },
        game.fireworksPlayers[1]!,
      ],
    }
    const next = applyEvent(game, "p0", { kind: "fw_play", card: { color: "red", number: 5 } })
    expect(next.fireworks.red).toBe(5)
    expect(next.numClocks).toBe(7)
  })
})

describe("Fireworks discard event", () => {
  it("discarding gains a clock and removes the card", () => {
    let game = initGame(2)
    game = { ...game, numClocks: 5 }
    const card = game.fireworksPlayers[0]!.cards[0]!
    const next = applyEvent(game, "p0", { kind: "fw_discard", card })
    expect(next.numClocks).toBe(6)
    expect(next.discardPile.cards).toContainEqual(card)
    expect(next.currentPlayerIndex).toBe(1)
  })

  it("discard draws a replacement card", () => {
    const game = initGame(2)
    const card = game.fireworksPlayers[0]!.cards[0]!
    const drawBefore = game.drawPile.cards.length
    const next = applyEvent(game, "p0", { kind: "fw_discard", card })
    expect(next.drawPile.cards.length).toBe(drawBefore - 1)
    // Hand size stays the same
    expect(next.fireworksPlayers[0]!.cards.length).toBe(game.fireworksPlayers[0]!.cards.length)
  })

  it("clocks cannot exceed 8", () => {
    let game = initGame(2)
    game = { ...game, numClocks: 8 }
    const card = game.fireworksPlayers[0]!.cards[0]!
    const next = applyEvent(game, "p0", { kind: "fw_discard", card })
    expect(next.numClocks).toBe(8)
  })
})

describe("Fireworks hint events", () => {
  it("infoColor decreases clocks and sets hint state", () => {
    const game = initGame(2)
    const next = applyEvent(game, "p0", { kind: "fw_infoColor", color: "red", hintFor: "p1" as PlayerId })
    expect(next.numClocks).toBe(7)
    expect(next.showColor).toBe("red")
    expect(next.showNumber).toBeNull()
    expect(next.hintForPlayer).toBe("p1")
    // currentPlayerIndex is set to -1 (waiting)
    expect(next.currentPlayerIndex).toBe(-1)
    expect(next.nextPlayerIndex).toBe(1) // next after p0
  })

  it("infoNumber decreases clocks and sets hint state", () => {
    const game = initGame(2)
    const next = applyEvent(game, "p0", { kind: "fw_infoNumber", number: 3, hintFor: "p1" as PlayerId })
    expect(next.numClocks).toBe(7)
    expect(next.showNumber).toBe(3)
    expect(next.showColor).toBeNull()
    expect(next.hintForPlayer).toBe("p1")
  })

  it("hint fails when no clocks remain", () => {
    let game = initGame(2)
    game = { ...game, numClocks: 0 }
    const exit = applyEventEither(game, "p0", { kind: "fw_infoColor", color: "red", hintFor: "p1" as PlayerId })
    expect(exit._tag).toBe("Failure")
  })

  it("cannot hint yourself", () => {
    const game = initGame(2)
    const exit = applyEventEither(game, "p0", { kind: "fw_infoColor", color: "red", hintFor: "p0" as PlayerId })
    expect(exit._tag).toBe("Failure")
  })
})

describe("Fireworks sawHint event", () => {
  it("clears hint and advances turn", () => {
    const game = initGame(2)
    const hinted = applyEvent(game, "p0", { kind: "fw_infoColor", color: "red", hintFor: "p1" as PlayerId })
    const next = applyEvent(hinted, "p1", { kind: "fw_sawHint" })
    expect(next.showColor).toBeNull()
    expect(next.showNumber).toBeNull()
    expect(next.hintForPlayer).toBeNull()
    // currentPlayerIndex should be nextPlayerIndex (1)
    expect(next.currentPlayerIndex).toBe(1)
  })

  it("wrong player cannot acknowledge hint", () => {
    const game = initGame(3)
    const hinted = applyEvent(game, "p0", { kind: "fw_infoColor", color: "red", hintFor: "p1" as PlayerId })
    const exit = applyEventEither(hinted, "p2", { kind: "fw_sawHint" })
    expect(exit._tag).toBe("Failure")
  })
})

describe("Fireworks round over", () => {
  it("game over when fuses reach 0", () => {
    let game = initGame(2)
    game = { ...game, numFuses: 0 }
    expect(fireworksFunctions.isRoundOver(game)).toBe(true)
    expect(fireworksFunctions.isGameOver(game, makeConfig())).toBe(true)
  })

  it("game over when playerOut equals currentPlayerIndex", () => {
    let game = initGame(2)
    game = { ...game, playerOut: 0, currentPlayerIndex: 0 }
    expect(fireworksFunctions.isRoundOver(game)).toBe(true)
  })

  it("game not over when playerOut is set but not yet reached", () => {
    let game = initGame(2)
    game = { ...game, playerOut: 0, currentPlayerIndex: 1 }
    expect(fireworksFunctions.isRoundOver(game)).toBe(false)
  })
})

describe("Fireworks turn validation", () => {
  it("wrong player move is rejected", () => {
    const game = initGame(2)
    // p1 tries to play on p0's turn
    const card = game.fireworksPlayers[1]!.cards[0]!
    const exit = applyEventEither(game, "p1", { kind: "fw_play", card })
    expect(exit._tag).toBe("Failure")
  })

  it("cannot make a regular move while hint is pending", () => {
    const game = initGame(2)
    const hinted = applyEvent(game, "p0", { kind: "fw_infoColor", color: "red", hintFor: "p1" as PlayerId })
    const card = hinted.fireworksPlayers[0]!.cards[0]!
    const exit = applyEventEither(hinted, "p0", { kind: "fw_play", card })
    expect(exit._tag).toBe("Failure")
  })

  it("cannot act when game is over", () => {
    let game = initGame(2)
    game = { ...game, numFuses: 0 }
    const card = game.fireworksPlayers[0]!.cards[0]!
    const exit = applyEventEither(game, "p0", { kind: "fw_play", card })
    expect(exit._tag).toBe("Failure")
  })
})

describe("Fireworks score", () => {
  it("computes score as sum of firework values", () => {
    let game = initGame(2)
    game = { ...game, fireworks: { red: 5, green: 3, blue: 2, white: 1, yellow: 0 } }
    expect(fireworksScore(game)).toBe(11)
  })

  it("perfect score is 25", () => {
    let game = initGame(2)
    game = { ...game, fireworks: { red: 5, green: 5, blue: 5, white: 5, yellow: 5 } }
    expect(fireworksScore(game)).toBe(25)
  })
})
