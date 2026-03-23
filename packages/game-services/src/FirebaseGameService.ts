import { Effect, Layer, Schema } from "effect"
import type { GameCode, PlayerId, GameConfig, GameInfo, Lobby } from "@games/effect-schemas"
import {
  CreateGameResponse,
  JoinGameResponse,
  DeleteGameResponse,
  GetGamesResponse,
  GameState,
  GameNotFound,
  NotAdmin,
  GameFull,
} from "@games/effect-schemas"
import { Lobby as LobbySchema } from "@games/effect-schemas"
import { GameService } from "./GameService.js"
import { HttpClient, HttpError } from "./HttpClient.js"

const mapHttpToGameError = (code: GameCode) => (err: HttpError) => {
  if (err.status === 404) {
    return new GameNotFound({ code })
  }
  if (err.status === 403) {
    return new NotAdmin({ playerId: "" as PlayerId })
  }
  if (err.status === 409) {
    return new GameFull({ code, maxPlayers: 0 })
  }
  // For other errors, wrap as GameNotFound with the error message
  return new GameNotFound({ code })
}

export const FirebaseGameServiceLive = Layer.effect(
  GameService,
  Effect.gen(function* () {
    const http = yield* HttpClient

    return GameService.of({
      createGame: (playerId: PlayerId, config: GameConfig) =>
        Effect.gen(function* () {
          const res = yield* http.post(
            "/createGame",
            { playerID: playerId, config },
            CreateGameResponse
          )
          return res.code
        }),

      joinGame: (playerId: PlayerId, code: GameCode, name: string) =>
        http
          .post("/joinGame", { code, playerID: playerId, name }, JoinGameResponse)
          .pipe(
            Effect.map((res) => res.name),
            Effect.mapError(mapHttpToGameError(code))
          ),

      deleteGame: (playerId: PlayerId, code: GameCode) =>
        http
          .post("/deleteGame", { code, playerID: playerId }, DeleteGameResponse)
          .pipe(
            Effect.map((res) => res.success),
            Effect.mapError(mapHttpToGameError(code))
          ),

      getGames: (playerId: PlayerId) =>
        http
          .post("/getGames", { playerID: playerId }, GetGamesResponse)
          .pipe(Effect.map((res) => res.games)),

      getRoom: (code: GameCode) =>
        http
          .post(
            "/getRoom",
            { code },
            Schema.Struct({
              lobby: LobbySchema,
              state: Schema.NullOr(GameState),
            })
          )
          .pipe(Effect.mapError(() => new GameNotFound({ code }))),
    })
  })
)
