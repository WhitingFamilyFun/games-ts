import { describe, it, expect } from "vitest"
import { Effect, Layer, Schema, Stream, Option } from "effect"
import type { PlayerId, GameCode, GameConfig, GameState } from "@games/effect-schemas"
import { GameService } from "./GameService.js"
import { RoundService } from "./RoundService.js"
import { HttpClient, HttpError } from "./HttpClient.js"
import { FirebaseGameServiceLive } from "./FirebaseGameService.js"
import { FirebaseRoundServiceLive } from "./FirebaseRoundService.js"

// ---------------------------------------------------------------------------
// Mock HttpClient that returns canned responses keyed by path
// ---------------------------------------------------------------------------
type PostHandler = (body: unknown) => unknown

const makeTestHttpClient = (handlers: Record<string, PostHandler>) =>
  Layer.succeed(HttpClient, {
    post: (path, body, responseSchema) =>
      Effect.gen(function* () {
        const handler = handlers[path]
        if (!handler) {
          return yield* Effect.fail(
            new HttpError({ status: 404, message: `No handler for ${path}` })
          )
        }
        const raw = handler(body)
        return yield* Schema.decodeUnknown(responseSchema)(raw).pipe(
          Effect.mapError(
            (e) => new HttpError({ status: 0, message: `Decode error: ${e}` })
          )
        )
      }),
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const p1 = "player1" as PlayerId
const testCode = "ABCD" as GameCode

const flyloConfig: GameConfig = {
  gameType: "Flylo",
  adminID: p1,
  rounds: 1,
  minPlayers: 2,
  maxPlayers: 4,
  options: {},
}

const sampleFlyloPlayer = {
  deck: { cards: [{ number: "p1" }, { number: "p2" }, { number: "p3" }, { number: "p4" }] },
  currentScore: 0,
  discardToFlip: false,
  fromDiscard: false,
  card: null,
}

const sampleGameState = {
  type: "Flylo",
  status: "started",
  round: 1,
  players: [{ id: "player1", name: "Alice" }, { id: "player2", name: "Bob" }],
  readyPlayers: [],
  rewards: [0, 0],
  playerIds: ["player1", "player2"],
  flyloPlayers: [sampleFlyloPlayer, sampleFlyloPlayer],
  discardPile: { cards: [{ number: "p5" }] },
  drawPile: { cards: [{ number: "p6" }, { number: "p7" }] },
  currentPlayerIndex: 0,
  firstPlayerOutIndex: null,
  debug: false,
}

// ---------------------------------------------------------------------------
// FirebaseGameService tests
// ---------------------------------------------------------------------------
describe("FirebaseGameService", () => {
  it("createGame sends correct request and returns code", () => {
    const MockHttp = makeTestHttpClient({
      "/createGame": (body) => {
        expect(body).toEqual({ playerID: p1, config: flyloConfig })
        return { code: testCode }
      },
    })
    const TestLayer = FirebaseGameServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameService
        const code = yield* gs.createGame(p1, flyloConfig)
        expect(code).toBe(testCode)
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("joinGame sends correct request and returns name", () => {
    const MockHttp = makeTestHttpClient({
      "/joinGame": (body) => {
        expect(body).toEqual({ code: testCode, playerID: p1, name: "Alice" })
        return { name: "Alice" }
      },
    })
    const TestLayer = FirebaseGameServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameService
        const name = yield* gs.joinGame(p1, testCode, "Alice")
        expect(name).toBe("Alice")
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("deleteGame sends correct request and returns success", () => {
    const MockHttp = makeTestHttpClient({
      "/deleteGame": (body) => {
        expect(body).toEqual({ code: testCode, playerID: p1 })
        return { success: true }
      },
    })
    const TestLayer = FirebaseGameServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameService
        const result = yield* gs.deleteGame(p1, testCode)
        expect(result).toBe(true)
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("getGames returns games array", () => {
    const MockHttp = makeTestHttpClient({
      "/getGames": (body) => {
        expect(body).toEqual({ playerID: p1 })
        return {
          games: [
            {
              gameID: testCode,
              status: "lobby",
              creator: p1,
              config: flyloConfig,
              player: { id: p1, name: "Alice" },
              players: [{ id: p1, name: "Alice" }],
            },
          ],
        }
      },
    })
    const TestLayer = FirebaseGameServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameService
        const games = yield* gs.getGames(p1)
        expect(games).toHaveLength(1)
        expect(games[0]!.gameID).toBe(testCode)
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("joinGame maps 404 HttpError to GameNotFound", () => {
    const MockHttp = Layer.succeed(HttpClient, {
      post: (_path, _body, _schema) =>
        Effect.fail(new HttpError({ status: 404, message: "Not found" })) as any,
    })
    const TestLayer = FirebaseGameServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameService
        const result = yield* gs.joinGame(p1, testCode, "Alice").pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("GameNotFound")
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("deleteGame maps 403 HttpError to NotAdmin", () => {
    const MockHttp = Layer.succeed(HttpClient, {
      post: (_path, _body, _schema) =>
        Effect.fail(new HttpError({ status: 403, message: "Forbidden" })) as any,
    })
    const TestLayer = FirebaseGameServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameService
        const result = yield* gs.deleteGame(p1, testCode).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("NotAdmin")
      }).pipe(Effect.provide(TestLayer))
    )
  })
})

// ---------------------------------------------------------------------------
// FirebaseRoundService tests
// ---------------------------------------------------------------------------
describe("FirebaseRoundService", () => {
  it("startGame sends correct request and returns state", () => {
    const MockHttp = makeTestHttpClient({
      "/startGame": (body) => {
        expect(body).toEqual({ code: testCode, playerID: p1 })
        return { state: sampleGameState }
      },
    })
    const TestLayer = FirebaseRoundServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const rs = yield* RoundService
        const state = yield* rs.startGame(p1, testCode)
        expect(state.status).toBe("started")
        expect(state.round).toBe(1)
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("sendEvent sends correct request and returns updated state", () => {
    const MockHttp = makeTestHttpClient({
      "/sendEvent": (body) => {
        const b = body as any
        expect(b.code).toBe(testCode)
        expect(b.playerID).toBe(p1)
        expect(b.event).toBeDefined()
        return { state: { ...sampleGameState, round: 2 } }
      },
    })
    const TestLayer = FirebaseRoundServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const rs = yield* RoundService
        const event = { kind: "flip", index: 0 }
        const state = yield* rs.sendEvent(p1, testCode, event as any)
        expect(state.round).toBe(2)
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("nextRound sends correct request and returns new state", () => {
    const MockHttp = makeTestHttpClient({
      "/nextRound": (body) => {
        expect(body).toEqual({ code: testCode, playerID: p1 })
        return { state: { ...sampleGameState, round: 2 } }
      },
    })
    const TestLayer = FirebaseRoundServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const rs = yield* RoundService
        const state = yield* rs.nextRound(p1, testCode)
        expect(state.round).toBe(2)
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("startGame maps 404 HttpError to GameNotFound", () => {
    const MockHttp = Layer.succeed(HttpClient, {
      post: (_path, _body, _schema) =>
        Effect.fail(new HttpError({ status: 404, message: "Not found" })) as any,
    })
    const TestLayer = FirebaseRoundServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const rs = yield* RoundService
        const result = yield* rs.startGame(p1, testCode).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("GameNotFound")
      }).pipe(Effect.provide(TestLayer))
    )
  })

  it("startGame maps 403 HttpError to NotAdmin", () => {
    const MockHttp = Layer.succeed(HttpClient, {
      post: (_path, _body, _schema) =>
        Effect.fail(new HttpError({ status: 403, message: "Forbidden" })) as any,
    })
    const TestLayer = FirebaseRoundServiceLive.pipe(Layer.provide(MockHttp))

    return Effect.runPromise(
      Effect.gen(function* () {
        const rs = yield* RoundService
        const result = yield* rs.startGame(p1, testCode).pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.succeed("success" as const),
            onFailure: (e) => Effect.succeed(e._tag),
          })
        )
        expect(result).toBe("NotAdmin")
      }).pipe(Effect.provide(TestLayer))
    )
  })
})
