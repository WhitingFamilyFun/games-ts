import { Effect, Ref, Context, Layer } from "effect"
import type {
  GameCode, PlayerId, GameConfig, GameInfo, Lobby,
  Player, GameStatus, GameState,
} from "@games/effect-schemas"
import {
  GameNotFound, GameFull, NotAdmin,
} from "@games/effect-schemas"
import { GameService } from "./GameService.js"

export interface Room {
  readonly code: GameCode
  readonly config: GameConfig
  readonly players: ReadonlyArray<Player>
  readonly gameStatus: GameStatus
  readonly state: GameState | null
}

export type RoomsRef = Ref.Ref<ReadonlyMap<string, Room>>

export class MockRooms extends Context.Tag("MockRooms")<
  MockRooms, RoomsRef
>() {}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function generateCode(existing: ReadonlyMap<string, unknown>): GameCode {
  for (let attempts = 0; attempts < 1000; attempts++) {
    let code = ""
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    if (!existing.has(code)) {
      return code as GameCode
    }
  }
  throw new Error("Unable to allocate a game code")
}

export const MockGameServiceLive = Layer.effect(
  GameService,
  Effect.gen(function* () {
    const rooms = yield* MockRooms

    return GameService.of({
      createGame: (playerId: PlayerId, config: GameConfig) =>
        Ref.modify(rooms, (map) => {
          const code = generateCode(map)
          const room: Room = {
            code,
            config: { ...config, adminID: playerId },
            players: [],
            gameStatus: "lobby",
            state: null,
          }
          const next = new Map(map)
          next.set(code, room)
          return [code, next] as const
        }),

      joinGame: (playerId: PlayerId, code: GameCode, name: string) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          const room = map.get(code)
          if (!room) {
            return yield* new GameNotFound({ code })
          }
          if (room.gameStatus !== "lobby" && !room.players.some((p) => p.id === playerId)) {
            return yield* new GameFull({ code, maxPlayers: room.config.maxPlayers })
          }
          if (room.players.length >= room.config.maxPlayers && !room.players.some((p) => p.id === playerId)) {
            return yield* new GameFull({ code, maxPlayers: room.config.maxPlayers })
          }

          const updated: Room = {
            ...room,
            players: [
              ...room.players.filter((p) => p.id !== playerId),
              { id: playerId, name },
            ],
          }
          yield* Ref.update(rooms, (m) => {
            const next = new Map(m)
            next.set(code, updated)
            return next
          })
          return name
        }),

      deleteGame: (playerId: PlayerId, code: GameCode) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          const room = map.get(code)
          if (!room) {
            return yield* new GameNotFound({ code })
          }
          if (room.config.adminID !== playerId) {
            return yield* new NotAdmin({ playerId })
          }
          yield* Ref.update(rooms, (m) => {
            const next = new Map(m)
            next.delete(code)
            return next
          })
          return true
        }),

      getGames: (playerId: PlayerId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          const result: GameInfo[] = []
          for (const room of map.values()) {
            const player = room.players.find((p) => p.id === playerId)
            if (player) {
              result.push({
                gameID: room.code,
                status: room.gameStatus,
                creator: room.config.adminID,
                config: room.config,
                player,
                players: [...room.players],
              })
            }
          }
          return result as readonly GameInfo[]
        }),

      getRoom: (code: GameCode) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          const room = map.get(code)
          if (!room) {
            return yield* new GameNotFound({ code })
          }
          const lobby: Lobby = {
            code: room.code,
            config: room.config,
            gameStatus: room.gameStatus,
            players: [...room.players],
          }
          return { lobby, state: room.state }
        }),
    })
  })
)
