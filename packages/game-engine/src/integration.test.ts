import { describe, it, expect, beforeAll } from "vitest"
import { Effect } from "effect"
import { GameRegistry } from "./engine.js"
import { registerAllGames } from "./register.js"
import type { PlayerId, GameConfig, Player, FlyloEvent } from "@games/effect-schemas"
import { updateStatus, addReadyPlayer } from "@games/effect-schemas"

beforeAll(() => {
  GameRegistry.clear()
  registerAllGames()
})

describe("Game lifecycle via registry", () => {
  const config: GameConfig = {
    gameType: "Flylo",
    adminID: "p1" as PlayerId,
    rounds: 1, minPlayers: 2, maxPlayers: 4,
    options: { randomSeed: 42 },
  }

  const players: Player[] = [
    { id: "p1" as PlayerId, name: "Alice" },
    { id: "p2" as PlayerId, name: "Bob" },
  ]

  it("creates initial state via registry dispatch", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state).toBeDefined()
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
  })

  it("generic helpers work on registry-returned state", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    const paused = updateStatus(state, "betweenRounds")
    expect(paused.status).toBe("betweenRounds")
    const ready = addReadyPlayer(paused, "p1" as PlayerId)
    expect(ready.readyPlayers).toEqual(["p1"])
  })

  it("processes event via registry dispatch", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    const event = { kind: "flip", index: 0 } as FlyloEvent
    const next = await Effect.runPromise(
      fns.next(state, config, "p1" as PlayerId, event)
    )
    expect(next).toBeDefined()
  })

  it("both game types are registered", () => {
    expect(GameRegistry.has("Flylo")).toBe(true)
    expect(GameRegistry.has("Flixx")).toBe(true)
  })
})
