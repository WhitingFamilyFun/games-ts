import { Effect, Layer, Stream, Schedule, Schema } from "effect"
import type { GameCode, PlayerId, GameEvent } from "@games/effect-schemas"
import {
  GameState,
  Lobby,
  StartGameResponse,
  SendEventResponse,
  NextRoundResponse,
  GameNotFound,
  NotAdmin,
  InvalidGameState,
} from "@games/effect-schemas"
import type { GameError } from "@games/effect-schemas"
import { RoundService } from "./RoundService.js"
import { HttpClient, HttpError } from "./HttpClient.js"

// Schemas for polling endpoints
const GameStatePollResponse = Schema.Struct({ state: GameState })
const LobbyPollResponse = Schema.Struct({ lobby: Lobby })

const mapHttpToRoundError =
  (code: GameCode) =>
  (err: HttpError): GameError | GameNotFound => {
    if (err.status === 404) {
      return new GameNotFound({ code })
    }
    if (err.status === 403) {
      return new NotAdmin({ playerId: "" as PlayerId })
    }
    if (err.status === 422) {
      return new InvalidGameState({
        expected: "valid game state",
        actual: err.message,
      })
    }
    return new GameNotFound({ code })
  }

export const FirebaseRoundServiceLive = Layer.effect(
  RoundService,
  Effect.gen(function* () {
    const http = yield* HttpClient

    return RoundService.of({
      startGame: (playerId: PlayerId, code: GameCode) =>
        http
          .post(
            "/startGame",
            { code, playerID: playerId },
            StartGameResponse
          )
          .pipe(
            Effect.map((res) => res.state),
            Effect.mapError(mapHttpToRoundError(code))
          ),

      sendEvent: (playerId: PlayerId, code: GameCode, event: GameEvent) =>
        http
          .post(
            "/sendEvent",
            { code, playerID: playerId, event },
            SendEventResponse
          )
          .pipe(
            Effect.map((res) => res.state),
            Effect.mapError(mapHttpToRoundError(code))
          ),

      nextRound: (playerId: PlayerId, code: GameCode) =>
        http
          .post(
            "/nextRound",
            { code, playerID: playerId },
            NextRoundResponse
          )
          .pipe(
            Effect.map((res) => res.state),
            Effect.mapError(mapHttpToRoundError(code))
          ),

      gameStream: (code: GameCode) =>
        Stream.repeatEffect(
          http
            .post("/getGameState", { code }, GameStatePollResponse)
            .pipe(
              Effect.map((res) => res.state),
              Effect.mapError(() => new GameNotFound({ code }))
            )
        ).pipe(Stream.schedule(Schedule.spaced("2500 millis"))),

      lobbyStream: (code: GameCode) =>
        Stream.repeatEffect(
          http
            .post("/getLobby", { code }, LobbyPollResponse)
            .pipe(
              Effect.map((res) => res.lobby),
              Effect.mapError(() => new GameNotFound({ code }))
            )
        ).pipe(Stream.schedule(Schedule.spaced("2500 millis"))),
    })
  })
)
