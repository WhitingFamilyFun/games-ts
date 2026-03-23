import { Schema } from "effect"

export const PlayerId = Schema.String.pipe(Schema.brand("PlayerId"))
export type PlayerId = typeof PlayerId.Type

export const GameCode = Schema.String.pipe(Schema.brand("GameCode"))
export type GameCode = typeof GameCode.Type

export const GameType = Schema.Literal("Flylo", "Flixx")
export type GameType = typeof GameType.Type

export const Player = Schema.Struct({
  id: PlayerId,
  name: Schema.optionalWith(Schema.String, { default: () => "" }),
})
export type Player = typeof Player.Type

export const GameStatus = Schema.Literal("lobby", "started", "betweenRounds", "finished")
export type GameStatus = typeof GameStatus.Type

export const GameConfig = Schema.Struct({
  gameType: GameType,
  adminID: Schema.optionalWith(PlayerId, { default: () => "" as PlayerId }),
  rounds: Schema.optionalWith(Schema.Number, { default: () => 1 }),
  minPlayers: Schema.optionalWith(Schema.Number, { default: () => 2 }),
  maxPlayers: Schema.optionalWith(Schema.Number, { default: () => 20 }),
  options: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    { default: () => ({}) }
  ),
})
export type GameConfig = typeof GameConfig.Type

// GenericFields: the common fields every game state must have.
// Game-specific schemas extend this via Schema intersection.
// Pure helper functions use `<G extends GenericFields>` to work on any game.
export const GenericFields = Schema.Struct({
  status: GameStatus,
  round: Schema.Number,
  players: Schema.Array(Player),
  readyPlayers: Schema.optionalWith(Schema.Array(PlayerId), { default: () => [] as readonly PlayerId[] }),
  rewards: Schema.optionalWith(Schema.Array(Schema.Number), { default: () => [] as readonly number[] }),
})
export type GenericFields = typeof GenericFields.Type
