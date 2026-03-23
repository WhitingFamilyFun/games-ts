import { Effect, Ref, Layer, Stream } from "effect"
import type {
  GameCode, PlayerId, GameState, GameEvent, Lobby,
} from "@games/effect-schemas"
import {
  GameNotFound, NotAdmin, InvalidGameState,
} from "@games/effect-schemas"
import { GameRegistry } from "@games/game-engine"
import { RoundService } from "./RoundService.js"
import { MockRooms, type Room } from "./MockGameService.js"

export const MockRoundServiceLive = Layer.effect(
  RoundService,
  Effect.gen(function* () {
    const rooms = yield* MockRooms

    const getRoom = (code: GameCode) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(rooms)
        const room = map.get(code)
        if (!room) {
          return yield* new GameNotFound({ code })
        }
        return room
      })

    const updateRoom = (code: GameCode, room: Room) =>
      Ref.update(rooms, (m) => {
        const next = new Map(m)
        next.set(code, room)
        return next
      })

    return RoundService.of({
      startGame: (playerId: PlayerId, code: GameCode) =>
        Effect.gen(function* () {
          const room = yield* getRoom(code)
          if (room.config.adminID !== playerId) {
            return yield* new NotAdmin({ playerId })
          }
          if (room.players.length < room.config.minPlayers) {
            return yield* new InvalidGameState({
              expected: `at least ${room.config.minPlayers} players`,
              actual: `${room.players.length} players`,
            })
          }

          const fns = GameRegistry.get(room.config.gameType)
          const state = yield* fns.initialState(room.config, room.players)

          const updated: Room = {
            ...room,
            gameStatus: "started",
            state: state as GameState,
          }
          yield* updateRoom(code, updated)
          return state as GameState
        }),

      sendEvent: (playerId: PlayerId, code: GameCode, event: GameEvent) =>
        Effect.gen(function* () {
          const room = yield* getRoom(code)
          if (!room.state) {
            return yield* new GameNotFound({ code })
          }

          const fns = GameRegistry.get(room.config.gameType)
          const nextState = yield* fns.next(
            room.state,
            room.config,
            playerId,
            event,
          )

          const updated: Room = { ...room, state: nextState as GameState }
          yield* updateRoom(code, updated)
          return nextState as GameState
        }),

      nextRound: (playerId: PlayerId, code: GameCode) =>
        Effect.gen(function* () {
          const room = yield* getRoom(code)
          if (!room.state) {
            return yield* new GameNotFound({ code })
          }

          const fns = GameRegistry.get(room.config.gameType)
          if (!fns.isRoundOver(room.state)) {
            return yield* new InvalidGameState({
              expected: "round over",
              actual: "round in progress",
            })
          }

          const nextState = yield* fns.nextRound(room.state, room.config)
          const updated: Room = { ...room, state: nextState as GameState }
          yield* updateRoom(code, updated)
          return nextState as GameState
        }),

      gameStream: (code: GameCode) =>
        Stream.fromEffect(
          Effect.gen(function* () {
            const room = yield* getRoom(code)
            if (!room.state) {
              return yield* new GameNotFound({ code })
            }
            return room.state
          })
        ),

      lobbyStream: (code: GameCode) =>
        Stream.fromEffect(
          Effect.gen(function* () {
            const room = yield* getRoom(code)
            const lobby: Lobby = {
              code: room.code,
              config: room.config,
              gameStatus: room.gameStatus,
              players: [...room.players],
            }
            return lobby
          })
        ),
    })
  })
)
