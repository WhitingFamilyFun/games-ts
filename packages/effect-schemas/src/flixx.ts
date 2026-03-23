import { Schema } from "effect"
import { PlayerId, GenericFields } from "./common.js"

export const FlixxColor = Schema.Literal("red", "yellow", "green", "blue", "purple")
export type FlixxColor = typeof FlixxColor.Type

export const DiceRoll = Schema.Struct({
  value: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(6)),
})
export type DiceRoll = typeof DiceRoll.Type

export const FlixxRoll = Schema.Struct({
  white1: DiceRoll,
  white2: DiceRoll,
  coloredRolls: Schema.Record({ key: FlixxColor, value: DiceRoll }),
})
export type FlixxRoll = typeof FlixxRoll.Type

export const FlixxRow = Schema.Struct({
  color: FlixxColor,
  row: Schema.Array(Schema.Boolean), // 11 booleans (indices 2-12)
  locked: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  didLock: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})
export type FlixxRow = typeof FlixxRow.Type

export const FlixxCard = Schema.Struct({
  rows: Schema.Record({ key: FlixxColor, value: FlixxRow }),
  numPenalties: Schema.optionalWith(Schema.Number, { default: () => 0 }),
})
export type FlixxCard = typeof FlixxCard.Type

export const FlixxPlayer = Schema.Struct({ card: FlixxCard })
export type FlixxPlayer = typeof FlixxPlayer.Type

// Events use `kind` discriminator (matching existing game logic)
export const FlixxRollEvent = Schema.Struct({ kind: Schema.Literal("roll") })
export const FlixxPassEvent = Schema.Struct({ kind: Schema.Literal("pass") })
export const FlixxTakePenaltyEvent = Schema.Struct({ kind: Schema.Literal("takePenalty") })
export const FlixxTakeRollEvent = Schema.Struct({
  kind: Schema.Literal("takeRoll"),
  color: FlixxColor,
  index: Schema.Number,
})

export const FlixxEvent = Schema.Union(
  FlixxRollEvent,
  FlixxPassEvent,
  FlixxTakePenaltyEvent,
  FlixxTakeRollEvent
)
export type FlixxEvent = typeof FlixxEvent.Type

// CurrentPlayerChoice discriminated union (with data fields on each variant)
export const CurrentPlayerChoice = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("white"), index: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("colored"), color: FlixxColor, index: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("both"),
    whiteIndex: Schema.Number,
    color: FlixxColor,
    colorIndex: Schema.Number,
  }),
)
export type CurrentPlayerChoice = typeof CurrentPlayerChoice.Type

// FlixxGame extends GenericFields
const FlixxSpecific = Schema.Struct({
  type: Schema.Literal("Flixx"),
  flixxPlayers: Schema.Record({ key: PlayerId, value: FlixxPlayer }),
  playersSubmittedForRound: Schema.optionalWith(Schema.Array(PlayerId), { default: () => [] }),
  currentRoll: Schema.optionalWith(Schema.NullOr(FlixxRoll), { default: () => null }),
  currentChoice: Schema.optionalWith(CurrentPlayerChoice, { default: () => ({ kind: "none" as const }) }),
  rolled: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  currentPlayerIndex: Schema.Number,
})

export const FlixxGame = Schema.extend(GenericFields, FlixxSpecific)
export type FlixxGame = typeof FlixxGame.Type
