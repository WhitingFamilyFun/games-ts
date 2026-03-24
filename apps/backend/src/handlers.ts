import { Effect, Schema } from "effect"
import {
  CreateGameRequest,
  CreateGameResponse,
  JoinGameRequest,
  JoinGameResponse,
  DeleteGameRequest,
  DeleteGameResponse,
  GetGamesRequest,
  GetGamesResponse,
  StartGameRequest,
  StartGameResponse,
  SendEventRequest,
  SendEventResponse,
  NextRoundRequest,
  NextRoundResponse,
  GameState,
  Lobby,
  GameNotFound,
  InvalidGameState,
  type GameCode,
  type PlayerId,
  type Player,
  type GameConfig,
} from "@games/effect-schemas"
import { GameRegistry } from "@games/game-engine"
import { Database } from "./db.js"
import { generateGameCode, normalizeFirebaseState, sanitizeForFirebase } from "./utils.js"
import { recordStats } from "./stats.js"

// --- createGame ---

export const createGameHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(CreateGameRequest)(body)
    const db = yield* Database
    const code = yield* generateGameCode()

    yield* db.set(`games/${code}/creator`, req.playerID)
    yield* db.set(`games/${code}/lobby`, {
      code,
      players: [],
      config: req.config,
      gameStatus: "lobby",
    })

    return { code }
  })

// --- joinGame ---

export const joinGameHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(JoinGameRequest)(body)
    const db = yield* Database

    const status = yield* db.get(`games/${req.code}/lobby/gameStatus`)
    if (status == null) {
      return yield* new GameNotFound({ code: req.code })
    }

    const currPlayers = ((yield* db.get(`games/${req.code}/lobby/players`)) as readonly Player[] | null) ?? []
    const alreadyJoined = currPlayers.some((p: Player) => p.id === req.playerID)
    if (alreadyJoined) {
      return { name: "" }
    }

    yield* db.set(`games/${req.code}/lobby/players`, [
      ...currPlayers,
      { id: req.playerID, name: req.name },
    ])

    const currGames = ((yield* db.get(`users/${req.playerID}/games`)) as readonly string[] | null) ?? []
    yield* db.set(`users/${req.playerID}/games`, [...currGames, req.code])

    return { name: "" }
  })

// --- deleteGame ---

export const deleteGameHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(DeleteGameRequest)(body)
    const db = yield* Database

    const status = yield* db.get(`games/${req.code}/lobby/gameStatus`)
    if (status == null) {
      return yield* new GameNotFound({ code: req.code })
    }

    yield* db.remove(`games/${req.code}`)
    return { success: true }
  })

// --- getGames ---

export const getGamesHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(GetGamesRequest)(body)
    const db = yield* Database

    const oldGames = ((yield* db.get(`users/${req.playerID}/games`)) as readonly string[] | null) ?? []
    const games: Array<{
      gameID: string
      status: string
      creator: string
      config: GameConfig
      player: Player
      players: readonly Player[]
    }> = []
    const validCodes: string[] = []

    for (const code of oldGames) {
      const lobbyData = yield* db.get(`games/${code}/lobby`)
      if (lobbyData == null) continue

      const decoded = Schema.decodeUnknownSync(Lobby)(normalizeFirebaseState(lobbyData))
      const player = decoded.players.find((p) => p.id === req.playerID) ?? {
        id: req.playerID,
        name: "Not Found",
      }

      validCodes.push(code)
      games.push({
        gameID: decoded.code,
        status: decoded.gameStatus,
        creator: decoded.config.adminID,
        config: decoded.config,
        player,
        players: decoded.players,
      })
    }

    // Clean up stale codes
    if (validCodes.length !== oldGames.length) {
      yield* db.set(`users/${req.playerID}/games`, validCodes)
    }

    return { games }
  })

// --- startGame ---

export const startGameHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(StartGameRequest)(body)
    const db = yield* Database

    const status = yield* db.get(`games/${req.code}/lobby/gameStatus`)
    if (status == null) {
      return yield* new GameNotFound({ code: req.code })
    }
    if (status !== "lobby") {
      return yield* new InvalidGameState({ expected: "lobby", actual: String(status) })
    }

    const lobbyData = yield* db.get(`games/${req.code}/lobby`)
    const lobby = Schema.decodeUnknownSync(Lobby)(normalizeFirebaseState(lobbyData))

    const gameFns = GameRegistry.get(lobby.config.gameType)
    const initialState = yield* gameFns.initialState(lobby.config, lobby.players)

    yield* db.set(`games/${req.code}/state`, sanitizeForFirebase(initialState))
    yield* db.set(`games/${req.code}/lobby/gameStatus`, "started")

    return { state: initialState }
  })

// --- sendEvent ---

export const sendEventHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(SendEventRequest)(body)
    const db = yield* Database

    const status = yield* db.get(`games/${req.code}/lobby/gameStatus`)
    if (status == null) {
      return yield* new GameNotFound({ code: req.code })
    }
    if (status === "lobby") {
      return yield* new InvalidGameState({ expected: "started", actual: "lobby" })
    }

    const stateData = yield* db.get(`games/${req.code}/state`)
    const gameState = Schema.decodeUnknownSync(GameState)(normalizeFirebaseState(stateData))
    const configData = yield* db.get(`games/${req.code}/lobby/config`)
    const config = Schema.decodeUnknownSync(
      Schema.Struct({
        gameType: Schema.Literal("Flylo", "Flixx", "Fireworks", "Glum"),
        adminID: Schema.optional(Schema.String),
        rounds: Schema.optional(Schema.Number),
        minPlayers: Schema.optional(Schema.Number),
        maxPlayers: Schema.optional(Schema.Number),
        options: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      })
    )(normalizeFirebaseState(configData)) as GameConfig

    const gameFns = GameRegistry.get(config.gameType)
    const newState = yield* gameFns.next(gameState, config, req.playerID, req.event)

    yield* db.set(`games/${req.code}/state`, sanitizeForFirebase(newState))

    // Check if round just ended and record stats
    const wasRoundOver = gameFns.isRoundOver(gameState)
    const isNowRoundOver = gameFns.isRoundOver(newState)
    if (!wasRoundOver && isNowRoundOver && gameFns.onRoundEnd) {
      const entries = gameFns.onRoundEnd(gameState, newState, config)
      yield* recordStats(entries)
    }

    // Check if game just ended and record stats
    const wasGameOver = gameFns.isGameOver(gameState, config)
    const isNowGameOver = gameFns.isGameOver(newState, config)
    if (!wasGameOver && isNowGameOver && gameFns.onGameEnd) {
      const entries = gameFns.onGameEnd(newState, config)
      yield* recordStats(entries)
    }

    return { state: newState }
  })

// --- nextRound ---

export const nextRoundHandler = (body: unknown) =>
  Effect.gen(function* () {
    const req = yield* Schema.decodeUnknown(NextRoundRequest)(body)
    const db = yield* Database

    const status = yield* db.get(`games/${req.code}/lobby/gameStatus`)
    if (status == null) {
      return yield* new GameNotFound({ code: req.code })
    }
    if (status === "lobby") {
      return yield* new InvalidGameState({ expected: "started", actual: "lobby" })
    }

    const stateData = yield* db.get(`games/${req.code}/state`)
    const gameState = Schema.decodeUnknownSync(GameState)(normalizeFirebaseState(stateData))
    const configData = yield* db.get(`games/${req.code}/lobby/config`)
    const config = Schema.decodeUnknownSync(
      Schema.Struct({
        gameType: Schema.Literal("Flylo", "Flixx", "Fireworks", "Glum"),
        adminID: Schema.optional(Schema.String),
        rounds: Schema.optional(Schema.Number),
        minPlayers: Schema.optional(Schema.Number),
        maxPlayers: Schema.optional(Schema.Number),
        options: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      })
    )(normalizeFirebaseState(configData)) as GameConfig

    const gameFns = GameRegistry.get(config.gameType)
    const newState = yield* gameFns.nextRound(gameState, config)

    yield* db.set(`games/${req.code}/state`, sanitizeForFirebase(newState))
    return { state: newState }
  })

// getGameState and getLobby removed — replaced by Firebase RTDB real-time listeners
