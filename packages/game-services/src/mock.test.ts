import { describe, it, expect, beforeAll } from "vitest"
import { Effect, Ref, Layer, Stream, Option } from "effect"
import type { PlayerId, GameCode, GameConfig, FlyloEvent } from "@games/effect-schemas"
import { GameNotFound, NotAdmin } from "@games/effect-schemas"
import { registerAllGames, GameRegistry } from "@games/game-engine"
import { GameService } from "./GameService.js"
import { RoundService } from "./RoundService.js"
import { MockRooms, MockGameServiceLive, type RoomsRef } from "./MockGameService.js"
import { MockRoundServiceLive } from "./MockRoundService.js"

beforeAll(() => {
  GameRegistry.clear()
  registerAllGames()
})

// Shared rooms layer — both services use the same Ref
const MockRoomsLive = Layer.effect(
  MockRooms,
  Ref.make<ReadonlyMap<string, never>>(new Map())
)

const TestLayer = Layer.mergeAll(MockGameServiceLive, MockRoundServiceLive).pipe(
  Layer.provide(MockRoomsLive)
)

const runTest = <A, E>(effect: Effect.Effect<A, E, GameService | RoundService>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer))

const p1 = "player1" as PlayerId
const p2 = "player2" as PlayerId

const flyloConfig: GameConfig = {
  gameType: "Flylo",
  adminID: "" as PlayerId, // will be set by createGame
  rounds: 1,
  minPlayers: 2,
  maxPlayers: 4,
  options: {},
}

describe("MockGameService", () => {
  it("creates a game and returns a 4-char code", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const code = yield* gs.createGame(p1, flyloConfig)
        expect(code).toHaveLength(4)
      })
    ))

  it("joinGame adds a player", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        yield* gs.joinGame(p2, code, "Bob")
        const games = yield* gs.getGames(p1)
        const game = games.find((g) => g.gameID === code)
        expect(game).toBeDefined()
        expect(game!.players).toHaveLength(2)
      })
    ))

  it("getGames filters by player participation", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        const p1Games = yield* gs.getGames(p1)
        const p2Games = yield* gs.getGames(p2)
        expect(p1Games.length).toBeGreaterThanOrEqual(1)
        expect(p2Games.find((g) => g.gameID === code)).toBeUndefined()
      })
    ))

  it("deleteGame removes the game", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        const result = yield* gs.deleteGame(p1, code)
        expect(result).toBe(true)
        const games = yield* gs.getGames(p1)
        expect(games.find((g) => g.gameID === code)).toBeUndefined()
      })
    ))

  it("deleteGame fails with NotAdmin for non-admin", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const code = yield* gs.createGame(p1, flyloConfig)
        const result = yield* gs.deleteGame(p2, code).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("NotAdmin")
      })
    ))

  it("joinGame fails with GameNotFound for invalid code", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const result = yield* gs.joinGame(p1, "ZZZZ" as GameCode, "Alice").pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("GameNotFound")
      })
    ))
})

describe("MockRoundService", () => {
  it("startGame creates initial state with generic fields", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const rs = yield* RoundService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        yield* gs.joinGame(p2, code, "Bob")
        const state = yield* rs.startGame(p1, code)
        expect(state.status).toBe("started")
        expect(state.round).toBe(1)
        expect(state.players).toHaveLength(2)
      })
    ))

  it("startGame fails with NotAdmin for non-admin", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const rs = yield* RoundService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        yield* gs.joinGame(p2, code, "Bob")
        const result = yield* rs.startGame(p2, code).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("NotAdmin")
      })
    ))

  it("sendEvent advances game state", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const rs = yield* RoundService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        yield* gs.joinGame(p2, code, "Bob")
        const initialState = yield* rs.startGame(p1, code)

        // Flylo: flip a card
        const event = { kind: "flip", index: 0 } as FlyloEvent
        const nextState = yield* rs.sendEvent(p1, code, event)
        expect(nextState).toBeDefined()
        expect(nextState.status).toBeDefined()
      })
    ))

  it("sendEvent fails with GameNotFound for invalid code", () =>
    runTest(
      Effect.gen(function* () {
        const rs = yield* RoundService
        const event = { kind: "flip", index: 0 } as FlyloEvent
        const result = yield* rs.sendEvent(p1, "ZZZZ" as GameCode, event).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("GameNotFound")
      })
    ))

  it("lobbyStream returns lobby info", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const rs = yield* RoundService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        const lobbyOpt = yield* Stream.runHead(rs.lobbyStream(code))
        expect(Option.isSome(lobbyOpt)).toBe(true)
        const lobby = Option.getOrThrow(lobbyOpt)
        expect(lobby.code).toBe(code)
        expect(lobby.players).toHaveLength(1)
      })
    ))

  it("gameStream returns current state after start", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const rs = yield* RoundService
        const code = yield* gs.createGame(p1, flyloConfig)
        yield* gs.joinGame(p1, code, "Alice")
        yield* gs.joinGame(p2, code, "Bob")
        yield* rs.startGame(p1, code)
        const stateOpt = yield* Stream.runHead(rs.gameStream(code))
        expect(Option.isSome(stateOpt)).toBe(true)
        const state = Option.getOrThrow(stateOpt)
        expect(state.status).toBe("started")
      })
    ))
})

describe("Full lifecycle", () => {
  it("create -> join -> start -> sendEvent -> verify state", () =>
    runTest(
      Effect.gen(function* () {
        const gs = yield* GameService
        const rs = yield* RoundService

        // 1. Create game
        const code = yield* gs.createGame(p1, flyloConfig)
        expect(code).toHaveLength(4)

        // 2. Join with both players
        yield* gs.joinGame(p1, code, "Alice")
        yield* gs.joinGame(p2, code, "Bob")

        // 3. Start game
        const state = yield* rs.startGame(p1, code)
        expect(state.status).toBe("started")
        expect(state.round).toBe(1)
        expect(state.players).toHaveLength(2)

        // 4. Send event (flip card in Flylo)
        const event = { kind: "flip", index: 0 } as FlyloEvent
        const nextState = yield* rs.sendEvent(p1, code, event)
        expect(nextState).toBeDefined()

        // 5. Verify getGames still works
        const games = yield* gs.getGames(p1)
        const game = games.find((g) => g.gameID === code)
        expect(game).toBeDefined()
        expect(game!.status).toBe("started")
      })
    ))
})
