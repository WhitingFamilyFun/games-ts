import { Schema } from "effect"
import { PlayerId, GenericFields } from "./common.js"

// Standard playing card suits and values
export const FaceSuit = Schema.Literal("clubs", "spades", "hearts", "diamonds")
export type FaceSuit = typeof FaceSuit.Type

export const FaceValue = Schema.Literal(
  "ace", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "jack", "queen", "king"
)
export type FaceValue = typeof FaceValue.Type

export const FaceCard = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("normal"), suit: FaceSuit, value: FaceValue }),
  Schema.Struct({ kind: Schema.Literal("joker") }),
)
export type FaceCard = typeof FaceCard.Type

export const GlumDesignation = Schema.Literal("King", "Queen", "Villager", "Peasant", "Scum")
export type GlumDesignation = typeof GlumDesignation.Type

export const GlumSet = Schema.Struct({
  cards: Schema.Array(FaceCard),
  declaredValue: Schema.optionalWith(Schema.NullOr(FaceCard), { default: () => null }),
})
export type GlumSet = typeof GlumSet.Type

export const GlumPile = Schema.Struct({
  sets: Schema.Array(GlumSet),
})
export type GlumPile = typeof GlumPile.Type

export const GlumPlayer = Schema.Struct({
  deck: Schema.Array(FaceCard), // player's hand
  passed: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})
export type GlumPlayer = typeof GlumPlayer.Type

// Events - discriminated on `kind`
export const GlumPlaySetEvent = Schema.Struct({
  kind: Schema.Literal("glum_playSet"),
  glumSet: GlumSet,
})
export const GlumPassEvent = Schema.Struct({
  kind: Schema.Literal("glum_pass"),
})
export const GlumGiveEvent = Schema.Struct({
  kind: Schema.Literal("glum_give"),
  toPlayer: PlayerId,
  cards: Schema.Array(FaceCard),
})

export const GlumEvent = Schema.Union(GlumPlaySetEvent, GlumPassEvent, GlumGiveEvent)
export type GlumEvent = typeof GlumEvent.Type

// GlumGame extends GenericFields
const GlumSpecific = Schema.Struct({
  type: Schema.Literal("Glum"),
  playerIds: Schema.Array(PlayerId),
  glumPlayers: Schema.Array(GlumPlayer),
  pile: GlumPile,
  currentPlayerIndex: Schema.Number,
  outIndex: Schema.optionalWith(Schema.Array(Schema.Number), { default: () => [] }),
  finishedSetup: Schema.optionalWith(Schema.Array(Schema.Number), { default: () => [] }),
})

export const GlumGame = Schema.extend(GenericFields, GlumSpecific)
export type GlumGame = typeof GlumGame.Type
