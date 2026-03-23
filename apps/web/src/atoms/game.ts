import { Effect } from "effect"
import { runtimeAtom } from "./runtime.js"
import { GameService, RoundService } from "@games/game-services"
import type {
  GameCode,
  PlayerId,
  GameConfig,
  GameEvent,
} from "@games/effect-schemas"

// --- Game management actions ---

export const createGameAtom = runtimeAtom.fn(
  (input: { playerId: PlayerId; config: GameConfig }) =>
    Effect.gen(function* () {
      const svc = yield* GameService
      return yield* svc.createGame(input.playerId, input.config)
    }),
)

export const joinGameAtom = runtimeAtom.fn(
  (input: { playerId: PlayerId; code: GameCode; name: string }) =>
    Effect.gen(function* () {
      const svc = yield* GameService
      return yield* svc.joinGame(input.playerId, input.code, input.name)
    }),
)

export const deleteGameAtom = runtimeAtom.fn(
  (input: { playerId: PlayerId; code: GameCode }) =>
    Effect.gen(function* () {
      const svc = yield* GameService
      return yield* svc.deleteGame(input.playerId, input.code)
    }),
)

export const getGamesAtom = runtimeAtom.fn(
  (playerId: PlayerId) =>
    Effect.gen(function* () {
      const svc = yield* GameService
      return yield* svc.getGames(playerId)
    }),
)

export const getRoomAtom = runtimeAtom.fn(
  (code: GameCode) =>
    Effect.gen(function* () {
      const svc = yield* GameService
      return yield* svc.getRoom(code)
    }),
)

// --- Round management actions ---

export const startGameAtom = runtimeAtom.fn(
  (input: { playerId: PlayerId; code: GameCode }) =>
    Effect.gen(function* () {
      const svc = yield* RoundService
      return yield* svc.startGame(input.playerId, input.code)
    }),
)

export const sendEventAtom = runtimeAtom.fn(
  (input: { playerId: PlayerId; code: GameCode; event: GameEvent }) =>
    Effect.gen(function* () {
      const svc = yield* RoundService
      return yield* svc.sendEvent(input.playerId, input.code, input.event)
    }),
)

export const nextRoundAtom = runtimeAtom.fn(
  (input: { playerId: PlayerId; code: GameCode }) =>
    Effect.gen(function* () {
      const svc = yield* RoundService
      return yield* svc.nextRound(input.playerId, input.code)
    }),
)
