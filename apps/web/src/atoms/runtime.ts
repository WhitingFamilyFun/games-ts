import { Atom } from "@effect-atom/atom-react"
import { Effect, Layer, Ref } from "effect"
import {
  GameService,
  RoundService,
  MockGameServiceLive,
  MockRoundServiceLive,
  MockRooms,
  type Room,
} from "@games/game-services"
import { registerAllGames } from "@games/game-engine"

// Register all game implementations before any game logic runs
registerAllGames()

// Create a shared MockRooms layer (holds the in-memory rooms map)
const MockRoomsLive = Layer.effect(
  MockRooms,
  Ref.make<ReadonlyMap<string, Room>>(new Map()),
)

// Combine mock services with shared rooms
const MockLayer = Layer.mergeAll(MockGameServiceLive, MockRoundServiceLive).pipe(
  Layer.provide(MockRoomsLive),
)

// Use MockLayer for now; swap to FirebaseLayer via env var later
export const runtimeAtom = Atom.runtime(MockLayer)
