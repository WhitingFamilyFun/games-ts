import { Schema } from "effect"
import { PlayerId, GenericFields } from "./common.js"

export const FireworkColor = Schema.Literal("red", "green", "blue", "white", "yellow")
export type FireworkColor = typeof FireworkColor.Type

export const FireworksCard = Schema.Struct({
  color: FireworkColor,
  number: Schema.Number, // 1-5
})
export type FireworksCard = typeof FireworksCard.Type

export const FireworksDeck = Schema.Struct({
  cards: Schema.Array(FireworksCard),
})
export type FireworksDeck = typeof FireworksDeck.Type

export const FireworksPlayer = Schema.Struct({
  cards: Schema.Array(FireworksCard),
})
export type FireworksPlayer = typeof FireworksPlayer.Type

// Events - discriminated on `kind`
export const FireworksPlayEvent = Schema.Struct({
  kind: Schema.Literal("play"),
  card: FireworksCard,
})
export const FireworksDiscardEvent = Schema.Struct({
  kind: Schema.Literal("discard"),
  card: FireworksCard,
})
export const FireworksInfoColorEvent = Schema.Struct({
  kind: Schema.Literal("infoColor"),
  color: FireworkColor,
  hintFor: PlayerId,
})
export const FireworksInfoNumberEvent = Schema.Struct({
  kind: Schema.Literal("infoNumber"),
  number: Schema.Number,
  hintFor: PlayerId,
})
export const FireworksSawHintEvent = Schema.Struct({
  kind: Schema.Literal("sawHint"),
})

export const FireworksEvent = Schema.Union(
  FireworksPlayEvent,
  FireworksDiscardEvent,
  FireworksInfoColorEvent,
  FireworksInfoNumberEvent,
  FireworksSawHintEvent,
)
export type FireworksEvent = typeof FireworksEvent.Type

// FireworksGame extends GenericFields
const FireworksSpecific = Schema.Struct({
  type: Schema.Literal("Fireworks"),
  playerIds: Schema.Array(PlayerId),
  fireworksPlayers: Schema.Array(FireworksPlayer),
  fireworks: Schema.Record({ key: FireworkColor, value: Schema.Number }), // current value per color (0-5)
  drawPile: FireworksDeck,
  discardPile: FireworksDeck,
  currentPlayerIndex: Schema.Number,
  nextPlayerIndex: Schema.optionalWith(Schema.NullOr(Schema.Number), { default: () => null }),
  playerOut: Schema.optionalWith(Schema.NullOr(Schema.Number), { default: () => null }),
  hintForPlayer: Schema.optionalWith(Schema.NullOr(PlayerId), { default: () => null }),
  showColor: Schema.optionalWith(Schema.NullOr(FireworkColor), { default: () => null }),
  showNumber: Schema.optionalWith(Schema.NullOr(Schema.Number), { default: () => null }),
  numClocks: Schema.Number, // 0-8, hints remaining
  numFuses: Schema.Number,  // 0-3, failures remaining
})

export const FireworksGame = Schema.extend(GenericFields, FireworksSpecific)
export type FireworksGame = typeof FireworksGame.Type
