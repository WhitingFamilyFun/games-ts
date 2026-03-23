import { Schema } from "effect"
import { PlayerId, GenericFields } from "./common.js"

export const CardNum = Schema.Literal(
  "m2", "m1", "z",
  "p1", "p2", "p3", "p4", "p5", "p6",
  "p7", "p8", "p9", "p10", "p11", "p12"
)
export type CardNum = typeof CardNum.Type

export const CardColor = Schema.Literal("r", "g", "db", "lb", "y")
export type CardColor = typeof CardColor.Type

export const GameCard = Schema.Struct({
  number: CardNum,
  flipped: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})
export type GameCard = typeof GameCard.Type

export const Deck = Schema.Struct({
  cards: Schema.Array(GameCard),
})
export type Deck = typeof Deck.Type

export const FlyloPlayer = Schema.Struct({
  deck: Deck,
  currentScore: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  discardToFlip: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  fromDiscard: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  card: Schema.NullOr(GameCard),
})
export type FlyloPlayer = typeof FlyloPlayer.Type

// Discriminated union for events (uses `kind` to match existing game logic)
export const FlyloDrawEvent = Schema.Struct({
  kind: Schema.Literal("draw"),
  fromDiscard: Schema.Boolean,
})

export const FlyloFlipEvent = Schema.Struct({
  kind: Schema.Literal("flip"),
  index: Schema.Number,
})

export const FlyloDiscardEvent = Schema.Struct({
  kind: Schema.Literal("discard"),
})

export const FlyloReplaceEvent = Schema.Struct({
  kind: Schema.Literal("replace"),
  index: Schema.Number,
})

export const FlyloEvent = Schema.Union(
  FlyloDrawEvent,
  FlyloFlipEvent,
  FlyloDiscardEvent,
  FlyloReplaceEvent
)
export type FlyloEvent = typeof FlyloEvent.Type

// FlyloGame extends GenericFields — all generic fields are flat in the type.
// flyloPlayers is an ARRAY indexed by player order (playerIds[i] = flyloPlayers[i]).
const FlyloSpecific = Schema.Struct({
  type: Schema.Literal("Flylo"),
  playerIds: Schema.Array(PlayerId),
  flyloPlayers: Schema.Array(FlyloPlayer),
  discardPile: Deck,
  drawPile: Deck,
  currentPlayerIndex: Schema.Number,
  firstPlayerOutIndex: Schema.optionalWith(Schema.NullOr(Schema.Number), {
    default: () => null,
  }),
  debug: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})

export const FlyloGame = Schema.extend(GenericFields, FlyloSpecific)
export type FlyloGame = typeof FlyloGame.Type
// FlyloGame has: status, round, players, readyPlayers, rewards, type, playerIds, flyloPlayers, ...
