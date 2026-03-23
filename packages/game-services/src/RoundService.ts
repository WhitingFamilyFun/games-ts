import { Context, Effect, Stream } from "effect"
import type {
  GameCode, PlayerId, GameState, GameEvent, GameError,
  GameNotFound, NotAdmin, Lobby,
} from "@games/effect-schemas"

export interface RoundServiceApi {
  readonly startGame: (
    playerId: PlayerId, code: GameCode
  ) => Effect.Effect<GameState, GameNotFound | NotAdmin>

  readonly sendEvent: (
    playerId: PlayerId, code: GameCode, event: GameEvent
  ) => Effect.Effect<GameState, GameError | GameNotFound>

  readonly nextRound: (
    playerId: PlayerId, code: GameCode
  ) => Effect.Effect<GameState, GameError | GameNotFound>

  readonly gameStream: (
    code: GameCode
  ) => Stream.Stream<GameState, GameNotFound>

  readonly lobbyStream: (
    code: GameCode
  ) => Stream.Stream<Lobby, GameNotFound>
}

export class RoundService extends Context.Tag("RoundService")<
  RoundService, RoundServiceApi
>() {}
