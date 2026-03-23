import { Data } from "effect"

export class InvalidMove extends Data.TaggedError("InvalidMove")<{
  readonly message: string
  readonly playerId: string
}> {}

export class NotYourTurn extends Data.TaggedError("NotYourTurn")<{
  readonly playerId: string
  readonly currentPlayerId: string
}> {}

export class GameNotFound extends Data.TaggedError("GameNotFound")<{
  readonly code: string
}> {}

export class GameFull extends Data.TaggedError("GameFull")<{
  readonly code: string
  readonly maxPlayers: number
}> {}

export class NotAdmin extends Data.TaggedError("NotAdmin")<{
  readonly playerId: string
}> {}

export class InvalidGameState extends Data.TaggedError("InvalidGameState")<{
  readonly expected: string
  readonly actual: string
}> {}

export type GameError =
  | InvalidMove
  | NotYourTurn
  | GameNotFound
  | GameFull
  | NotAdmin
  | InvalidGameState
