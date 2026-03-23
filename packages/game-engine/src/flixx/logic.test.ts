import { Effect, Exit } from "effect"
import type { FlixxGame, FlixxRoll, GameConfig, Player, PlayerId } from "@games/effect-schemas"
import { InvalidMove, NotYourTurn } from "@games/effect-schemas"
import { describe, expect, it } from "vitest"
import { flixxFunctions, ALL_FLIXX_COLORS, lockedColors, isUnavailable } from "./logic.js"

const makeConfig = (): GameConfig => ({
  gameType: "Flixx",
  adminID: "" as PlayerId,
  options: {},
  rounds: 1,
  minPlayers: 2,
  maxPlayers: 20,
})

const makePlayers = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}` as PlayerId,
    name: `P${i}`,
  }))

function runSync<A, E>(effect: Effect.Effect<A, E>): Exit.Exit<A, E> {
  return Effect.runSyncExit(effect)
}

function unwrap<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`Expected success but got failure`)
}

function unwrapFailure<A, E>(exit: Exit.Exit<A, E>): E {
  if (Exit.isFailure(exit)) return exit.cause.valueOf() as E
  throw new Error(`Expected failure but got success`)
}

async function initGame(n: number): Promise<FlixxGame> {
  const exit = runSync(flixxFunctions.initialState(makeConfig(), makePlayers(n)))
  return unwrap(exit)
}

function currentPlayerId(g: FlixxGame): PlayerId {
  return Object.keys(g.flixxPlayers)[g.currentPlayerIndex]! as PlayerId
}

function nonCurrentPlayerId(g: FlixxGame): PlayerId {
  const ids = Object.keys(g.flixxPlayers)
  const next = (g.currentPlayerIndex + 1) % ids.length
  return ids[next]! as PlayerId
}

// Force a specific roll (white sum depends on test)
function withRoll(g: FlixxGame, roll: FlixxRoll): FlixxGame {
  return { ...g, rolled: true, currentRoll: roll }
}

// ---------------------------------------------------------------------------
describe("FlixxGame.initialize", () => {
  it("all players have cards", async () => {
    const g = await initGame(3)
    for (const pid of Object.keys(g.flixxPlayers)) {
      const p = g.flixxPlayers[pid as PlayerId]!
      expect(p.card.numPenalties).toBe(0)
      expect(ALL_FLIXX_COLORS.every(c => !!p.card.rows[c])).toBe(true)
    }
  })

  it("currentPlayerIndex is valid", async () => {
    const g = await initGame(3)
    expect(g.currentPlayerIndex).toBeGreaterThanOrEqual(0)
    expect(g.currentPlayerIndex).toBeLessThan(3)
  })

  it("not rolled at start", async () => {
    const g = await initGame(2)
    expect(g.rolled).toBe(false)
  })

  it("has generic fields from initGenericFields", async () => {
    const g = await initGame(3)
    expect(g.status).toBe("started")
    expect(g.round).toBe(1)
    expect(g.players).toHaveLength(3)
    expect(g.rewards).toEqual([0, 0, 0])
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - roll", () => {
  it("current player can roll", async () => {
    const g = await initGame(2)
    const pid = currentPlayerId(g)
    const exit = runSync(flixxFunctions.next(g, makeConfig(), pid, { kind: "roll" }))
    const result = unwrap(exit)
    expect(result.rolled).toBe(true)
  })

  it("only current player can roll", async () => {
    const g = await initGame(2)
    const pid = nonCurrentPlayerId(g)
    const exit = runSync(flixxFunctions.next(g, makeConfig(), pid, { kind: "roll" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("cannot roll twice in the same turn", async () => {
    const g = await initGame(2)
    const pid = currentPlayerId(g)
    const exit1 = runSync(flixxFunctions.next(g, makeConfig(), pid, { kind: "roll" }))
    const g2 = unwrap(exit1)
    const exit2 = runSync(flixxFunctions.next(g2, makeConfig(), pid, { kind: "roll" }))
    expect(Exit.isFailure(exit2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - takeRoll", () => {
  it("current player can take a colored + white sum", async () => {
    const g = await initGame(2)
    const pid = currentPlayerId(g)
    // Force a roll where red die = 3, white1 = 4, white2 = 2 -> red choice = 4+3=7
    const roll: FlixxRoll = {
      white1: { value: 4 }, white2: { value: 2 },
      coloredRolls: {
        red: { value: 3 }, yellow: { value: 1 },
        green: { value: 1 }, blue: { value: 1 }, purple: { value: 1 },
      },
    }
    const rolled = withRoll(g, roll)
    // Red, index 7 (lowToHigh: 7-2=5 in 0-based array) -- valid since 4+3=7
    const exit = runSync(
      flixxFunctions.next(rolled, makeConfig(), pid, { kind: "takeRoll", color: "red", index: 7 })
    )
    const result = unwrap(exit)
    const p = result.flixxPlayers[pid]!
    expect(p.card.rows["red"]!.row[5]).toBe(true)
  })

  it("non-current player can only use white sum", async () => {
    const g = await initGame(2)
    const pid = nonCurrentPlayerId(g)
    const roll: FlixxRoll = {
      white1: { value: 3 }, white2: { value: 4 },
      coloredRolls: {
        red: { value: 2 }, yellow: { value: 2 },
        green: { value: 2 }, blue: { value: 2 }, purple: { value: 2 },
      },
    }
    const rolled = withRoll(g, roll)
    // white sum = 7, must use 7 on any color
    const exit = runSync(
      flixxFunctions.next(rolled, makeConfig(), pid, { kind: "takeRoll", color: "red", index: 7 })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("non-current player cannot use colored + white", async () => {
    const g = await initGame(2)
    const pid = nonCurrentPlayerId(g)
    const roll: FlixxRoll = {
      white1: { value: 3 }, white2: { value: 4 },
      coloredRolls: {
        red: { value: 5 }, yellow: { value: 1 },
        green: { value: 1 }, blue: { value: 1 }, purple: { value: 1 },
      },
    }
    const rolled = withRoll(g, roll)
    // Try to take index 8 (red 5 + white1 3 = 8) as non-current player
    const exit = runSync(
      flixxFunctions.next(rolled, makeConfig(), pid, { kind: "takeRoll", color: "red", index: 8 })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("cannot take an already-taken cell", async () => {
    const g = await initGame(2)
    const pid = currentPlayerId(g)
    const roll: FlixxRoll = {
      white1: { value: 3 }, white2: { value: 4 },
      coloredRolls: {
        red: { value: 0 }, yellow: { value: 0 },
        green: { value: 0 }, blue: { value: 0 }, purple: { value: 0 },
      },
    }
    const rolled = withRoll(g, roll)
    const exit1 = runSync(
      flixxFunctions.next(rolled, makeConfig(), pid, { kind: "takeRoll", color: "red", index: 7 })
    )
    const g2 = unwrap(exit1)
    // Roll again and try same cell
    const rerolled = withRoll(g2, roll)
    const exit2 = runSync(
      flixxFunctions.next(rerolled, makeConfig(), pid, { kind: "takeRoll", color: "red", index: 7 })
    )
    expect(Exit.isFailure(exit2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - takePenalty", () => {
  it("adds a penalty to the player", async () => {
    const g = await initGame(2)
    const pid = currentPlayerId(g)
    const exit = runSync(
      flixxFunctions.next(g, makeConfig(), pid, { kind: "takePenalty" })
    )
    const result = unwrap(exit)
    expect(result.flixxPlayers[pid]!.card.numPenalties).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - pass", () => {
  it("marks player as submitted", async () => {
    const g = await initGame(2)
    const pid = Object.keys(g.flixxPlayers)[0]! as PlayerId
    const exit = runSync(
      flixxFunctions.next(g, makeConfig(), pid, { kind: "pass" })
    )
    const result = unwrap(exit)
    expect(result.playersSubmittedForRound).toContain(pid)
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - nextRound", () => {
  it("advances currentPlayerIndex", async () => {
    const g = await initGame(3)
    const initial = g.currentPlayerIndex
    const exit = runSync(flixxFunctions.nextRound(g, makeConfig()))
    const next = unwrap(exit)
    expect(next.currentPlayerIndex).toBe((initial + 1) % 3)
  })

  it("resets rolled to false", async () => {
    const g = await initGame(2)
    const withRolled: FlixxGame = { ...g, rolled: true }
    const exit = runSync(flixxFunctions.nextRound(withRolled, makeConfig()))
    const next = unwrap(exit)
    expect(next.rolled).toBe(false)
  })

  it("resets playersSubmittedForRound", async () => {
    const g = await initGame(2)
    const withSubmit: FlixxGame = { ...g, playersSubmittedForRound: ["p0" as PlayerId, "p1" as PlayerId] }
    const exit = runSync(flixxFunctions.nextRound(withSubmit, makeConfig()))
    const next = unwrap(exit)
    expect(next.playersSubmittedForRound).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - lockedColors", () => {
  it("returns empty set when nothing is locked", async () => {
    const g = await initGame(2)
    expect(lockedColors(g).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - isUnavailable", () => {
  it("returns false for a fresh cell", async () => {
    const g = await initGame(2)
    const pid = Object.keys(g.flixxPlayers)[0]!
    expect(isUnavailable(g, pid, "red", 2)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe("Flixx - isRoundOver", () => {
  it("is false for a fresh game", async () => {
    const g = await initGame(2)
    expect(flixxFunctions.isRoundOver(g)).toBe(false)
  })
})
