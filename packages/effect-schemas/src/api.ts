import { Schema } from "effect"
import { PlayerId, GameCode, Player, GameConfig, GameStatus } from "./common.js"
import { FlyloGame, FlyloEvent } from "./flylo.js"
import { FlixxGame, FlixxEvent } from "./flixx.js"
import { FireworksGame, FireworksEvent } from "./fireworks.js"
import { GlumGame, GlumEvent } from "./glum.js"

// Discriminated on `type` field ("Flylo" | "Flixx" | "Fireworks" | "Glum")
// All branches have GenericFields, so state.status, state.round, etc. always work
export const GameState = Schema.Union(FlyloGame, FlixxGame, FireworksGame, GlumGame)
export type GameState = typeof GameState.Type

export const GameEvent = Schema.Union(FlyloEvent, FlixxEvent, FireworksEvent, GlumEvent)
export type GameEvent = typeof GameEvent.Type

export const Lobby = Schema.Struct({
  code: GameCode,
  config: GameConfig,
  gameStatus: GameStatus,
  players: Schema.Array(Player),
})
export type Lobby = typeof Lobby.Type

// NOTE: This is an intentional redesign from the existing Zod schema.
// Existing had: creator: boolean (am I creator?), player: string, players: string[]
// New has: creator: PlayerId (who created it), player: Player, players: Player[]
// This is a breaking API change — the Dart backend must be updated to match.
export const GameInfo = Schema.Struct({
  gameID: GameCode,
  status: GameStatus,
  creator: PlayerId,
  config: GameConfig,
  player: Player,
  players: Schema.Array(Player),
})
export type GameInfo = typeof GameInfo.Type

// API Request/Response schemas
export const CreateGameRequest = Schema.Struct({ playerID: PlayerId, config: GameConfig })
export const CreateGameResponse = Schema.Struct({ code: GameCode })

export const JoinGameRequest = Schema.Struct({ code: GameCode, playerID: PlayerId, name: Schema.String })
export const JoinGameResponse = Schema.Struct({ name: Schema.String })

export const StartGameRequest = Schema.Struct({ code: GameCode, playerID: PlayerId })
export const StartGameResponse = Schema.Struct({ state: GameState })

export const SendEventRequest = Schema.Struct({ code: GameCode, playerID: PlayerId, event: GameEvent })
export const SendEventResponse = Schema.Struct({ state: GameState })

export const NextRoundRequest = Schema.Struct({ code: GameCode, playerID: PlayerId })
export const NextRoundResponse = Schema.Struct({ state: GameState })

export const DeleteGameRequest = Schema.Struct({ code: GameCode, playerID: PlayerId })
export const DeleteGameResponse = Schema.Struct({ success: Schema.Boolean })

export const GetGamesRequest = Schema.Struct({ playerID: PlayerId })
export const GetGamesResponse = Schema.Struct({ games: Schema.Array(GameInfo) })
