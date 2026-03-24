import { Context, Stream } from "effect"
import type { GameCode } from "@games/effect-schemas"
import type { RoomSnapshot } from "./GameService.js"

export interface RealtimeServiceApi {
  /** Subscribe to game state changes. Emits null when no state exists yet. */
  readonly watchRoom: (code: GameCode) => Stream.Stream<RoomSnapshot | null>
}

export class RealtimeService extends Context.Tag("RealtimeService")<
  RealtimeService,
  RealtimeServiceApi
>() {}
