import { Context, Effect } from "effect"
import type {
  GameCode, PlayerId, GameConfig, GameInfo, GameState, Lobby,
  GameNotFound, GameFull, NotAdmin,
} from "@games/effect-schemas"

export interface RoomSnapshot {
  readonly lobby: Lobby
  readonly state: GameState | null
}

export interface GameServiceApi {
  readonly createGame: (
    playerId: PlayerId, config: GameConfig
  ) => Effect.Effect<GameCode, never>

  readonly joinGame: (
    playerId: PlayerId, code: GameCode, name: string
  ) => Effect.Effect<string, GameNotFound | GameFull>

  readonly deleteGame: (
    playerId: PlayerId, code: GameCode
  ) => Effect.Effect<boolean, GameNotFound | NotAdmin>

  readonly getGames: (
    playerId: PlayerId
  ) => Effect.Effect<readonly GameInfo[]>

  readonly getRoom: (
    code: GameCode
  ) => Effect.Effect<RoomSnapshot, GameNotFound>
}

export class GameService extends Context.Tag("GameService")<
  GameService, GameServiceApi
>() {}
