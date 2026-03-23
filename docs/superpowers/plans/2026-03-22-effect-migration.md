# Effect Migration: Game Scaffold TypeScript Port

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the TypeScript game platform from ad-hoc patterns + Zod to the Effect ecosystem, gaining typed errors, dependency injection, schema-driven serialization, and a generic game scaffold matching the Dart original's abstractions — but using TypeScript's structural typing instead of nested wrappers.

**Architecture:** Game state types use intersection types: each game (FlyloGame, FlixxGame) includes generic fields (status, round, players, rewards) directly in its flat structure, and generic helper functions use `<G extends GenericFields>` constraints to work on any game state without wrapping/unwrapping. `Schema` replaces Zod. `Effect` replaces ad-hoc `MaybeError`. `Layer` provides DI. `@effect-atom/atom-react` manages React state.

**Tech Stack:** Effect v3 (effect package), TypeScript 5.6+, React 19, Vite, pnpm workspaces, Firebase Cloud Functions v2

---

## Current State Assessment

### What the TS port has today (~5k lines)
- **contracts**: Zod schemas for Player, GameConfig, Lobby, GameInfo, GameError, Flylo types, Flixx types, API request/response types
- **core-games**: Game logic for Flylo (434 lines) and Flixx (373 lines) as pure functions returning `MaybeError<T>` (ad-hoc Result type)
- **web app**: React frontend with gateway abstraction (mock + Firebase Functions), split-screen testing, Zustand for chrome state

### What's missing vs the Dart scaffold
1. No generic game abstraction — each game is ad-hoc
2. No `GameRegistry` for dynamic dispatch
3. No common fields (players, round, status, readyPlayers, rewards) shared across games
4. `MaybeError<T>` is plain union with no composition (no `map`, `flatMap`)
5. No service layer abstraction (gateway mixes concerns)
6. No `betweenRounds` status — only lobby/started/finished
7. No typed error hierarchy (just string errors)
8. No DI system (gateway selection is manual if/else)
9. Duplicate event-application logic across mock and functions gateways

### Key design decision: flat intersection types, not nested wrappers

The Dart scaffold uses `GameState<E, T>` which nests `GenericGame` + `T game` + `Rewards`. In TypeScript we can do better using structural typing:

```typescript
// Generic fields as a type constraint — not a wrapper
type GenericFields = {
  readonly status: GameStatus
  readonly round: number
  readonly players: readonly Player[]
  readonly readyPlayers: readonly PlayerId[]
  readonly rewards: readonly number[]
}

// Each game includes these fields directly (intersection)
type FlyloGame = GenericFields & {
  readonly type: "Flylo"
  readonly flyloPlayers: readonly FlyloPlayer[]
  readonly drawPile: Deck
  // ...
}

// Generic helpers work on ANY game via constraint — no unwrapping
const addReadyPlayer = <G extends GenericFields>(state: G, id: PlayerId): G => ({
  ...state,
  readyPlayers: [...state.readyPlayers, id],
})

// This returns the SAME concrete type — FlyloGame in, FlyloGame out
addReadyPlayer(flyloState, "p1") // ← still FlyloGame, not GenericFields
```

Benefits:
- `state.status` instead of `state.generic.status`
- No `updateGeneric(state, g => ...)` ceremony
- Generic helpers preserve the exact game type through `<G extends GenericFields>`
- TypeScript spread `{...state, field: newValue}` naturally preserves all fields

### Migration strategy
Replace from the bottom up: schemas first (foundation), then game logic (pure core), then services (side effects), then frontend (integration). Each task produces working, testable code independently.

---

## File Structure

```
web/packages/
├── effect-schemas/src/           # NEW - replaces contracts
│   ├── common.ts                 #   Player, GameConfig, GameStatus, GameError, GenericFields
│   ├── flylo.ts                  #   Flylo-specific schemas (extends GenericFields)
│   ├── flixx.ts                  #   Flixx-specific schemas (extends GenericFields)
│   ├── generic.ts                #   Pure functions over GenericFields constraint
│   ├── api.ts                    #   API request/response schemas
│   ├── errors.ts                 #   Tagged error classes
│   └── index.ts                  #   Barrel exports
├── game-engine/src/              # NEW - replaces core-games
│   ├── engine.ts                 #   GameFunctions interface, GameRegistry
│   ├── flylo/
│   │   ├── logic.ts              #   Flylo game functions (Effect-based)
│   │   ├── deck.ts               #   Deck utilities (pure, kept mostly as-is)
│   │   └── index.ts
│   ├── flixx/
│   │   ├── logic.ts              #   Flixx game functions (Effect-based)
│   │   └── index.ts
│   └── index.ts
├── game-services/src/            # NEW - service layer
│   ├── GameService.ts            #   GameService tag + interface
│   ├── RoundService.ts           #   RoundService tag + interface
│   ├── FirebaseGameService.ts    #   Firebase Layer implementation
│   ├── MockGameService.ts        #   In-memory Layer implementation
│   └── index.ts
└── apps/web/src/                 # MODIFY - frontend
    ├── atoms/                    #   NEW - Effect atoms for state
    │   ├── runtime.ts            #   Runtime atom with Layer
    │   ├── game.ts               #   Game state atoms
    │   └── session.ts            #   Session atoms
    ├── components/               #   NEW - split views out of App.tsx
    │   ├── HomeView.tsx
    │   ├── LobbyView.tsx
    │   ├── FlyloView.tsx
    │   └── FlixxView.tsx
    ├── App.tsx                   #   MODIFY - use atoms, import views
    ├── lib/
    │   ├── gateway.ts            #   REMOVE (replaced by services)
    │   ├── gameGateway.ts        #   REMOVE
    │   ├── functionsGateway.ts   #   REMOVE
    │   ├── mockBackend.ts        #   REMOVE
    │   └── sessionStore.ts       #   KEEP or migrate to atom
    └── main.tsx                  #   MODIFY - provide runtime
```

---

## Task 1: Bootstrap `effect-schemas` package with common types and errors

**Files:**
- Create: `web/packages/effect-schemas/package.json`
- Create: `web/packages/effect-schemas/tsconfig.json`
- Create: `web/packages/effect-schemas/src/index.ts`
- Create: `web/packages/effect-schemas/src/common.ts`
- Create: `web/packages/effect-schemas/src/errors.ts`
- Test: `web/packages/effect-schemas/src/common.test.ts`

- [ ] **Step 1: Create package scaffolding**

```json
// web/packages/effect-schemas/package.json
{
  "name": "@games/effect-schemas",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "effect": "^3.12.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

```json
// web/packages/effect-schemas/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Define common schemas and GenericFields**

```typescript
// web/packages/effect-schemas/src/common.ts
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
```

- [ ] **Step 3: Define typed error classes**

```typescript
// web/packages/effect-schemas/src/errors.ts
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
```

- [ ] **Step 4: Create barrel export**

```typescript
// web/packages/effect-schemas/src/index.ts
export * from "./common.js"
export * from "./errors.js"
```

- [ ] **Step 5: Write tests for common schemas**

```typescript
// web/packages/effect-schemas/src/common.test.ts
import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { Player, GameConfig, GameStatus, GenericFields, PlayerId } from "./common.js"

describe("Player schema", () => {
  it("decodes a valid player", () => {
    const result = Schema.decodeUnknownSync(Player)({ id: "p1", name: "Alice" })
    expect(result.id).toBe("p1")
    expect(result.name).toBe("Alice")
  })

  it("defaults name to empty string", () => {
    const result = Schema.decodeUnknownSync(Player)({ id: "p1" })
    expect(result.name).toBe("")
  })

  it("rejects missing id", () => {
    expect(() => Schema.decodeUnknownSync(Player)({ name: "Alice" })).toThrow()
  })

  it("round-trips through JSON", () => {
    const player = Schema.decodeUnknownSync(Player)({ id: "p1", name: "Bob" })
    const encoded = Schema.encodeSync(Player)(player)
    const decoded = Schema.decodeUnknownSync(Player)(encoded)
    expect(decoded).toEqual(player)
  })
})

describe("GameConfig schema", () => {
  it("decodes with defaults", () => {
    const config = Schema.decodeUnknownSync(GameConfig)({ gameType: "Flylo" })
    expect(config.rounds).toBe(1)
    expect(config.minPlayers).toBe(2)
    expect(config.maxPlayers).toBe(20)
    expect(config.options).toEqual({})
  })

  it("rejects invalid game type", () => {
    expect(() => Schema.decodeUnknownSync(GameConfig)({ gameType: "Boggle" })).toThrow()
  })
})

describe("GameStatus schema", () => {
  it("accepts all valid statuses", () => {
    for (const s of ["lobby", "started", "betweenRounds", "finished"]) {
      expect(Schema.decodeUnknownSync(GameStatus)(s)).toBe(s)
    }
  })

  it("rejects invalid status", () => {
    expect(() => Schema.decodeUnknownSync(GameStatus)("paused")).toThrow()
  })
})

describe("GenericFields schema", () => {
  it("decodes with defaults", () => {
    const g = Schema.decodeUnknownSync(GenericFields)({
      status: "started",
      round: 1,
      players: [{ id: "p1", name: "Alice" }],
    })
    expect(g.readyPlayers).toEqual([])
    expect(g.rewards).toEqual([])
  })
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && pnpm install && cd packages/effect-schemas && pnpm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add web/packages/effect-schemas/
git commit -m "feat: add effect-schemas package with common types, GenericFields, and typed errors"
```

---

## Task 2: Add generic helper functions over GenericFields constraint

**Files:**
- Create: `web/packages/effect-schemas/src/generic.ts`
- Modify: `web/packages/effect-schemas/src/index.ts`
- Test: `web/packages/effect-schemas/src/generic.test.ts`

These are pure functions that work on ANY game state via `<G extends GenericFields>`. They preserve the concrete type through TypeScript's generic spread.

- [ ] **Step 1: Define generic helper functions**

```typescript
// web/packages/effect-schemas/src/generic.ts
import type { GenericFields, GameStatus, PlayerId, Player } from "./common.js"

/** Update status, preserving the concrete game type */
export const updateStatus = <G extends GenericFields>(
  state: G,
  status: GameStatus
): G => ({ ...state, status })

/** Add a player to the ready list (idempotent) */
export const addReadyPlayer = <G extends GenericFields>(
  state: G,
  playerId: PlayerId
): G => ({
  ...state,
  readyPlayers: state.readyPlayers.includes(playerId)
    ? state.readyPlayers
    : [...state.readyPlayers, playerId],
})

/** Check if all players are ready */
export const allPlayersReady = (state: GenericFields): boolean =>
  state.players.length > 0 &&
  state.players.every((p) => state.readyPlayers.includes(p.id))

/** Advance to next round: increment round, clear ready, set status to started */
export const finishRound = <G extends GenericFields>(state: G): G => ({
  ...state,
  round: state.round + 1,
  readyPlayers: [],
  status: "started" as GameStatus,
})

/** Add round rewards to cumulative rewards */
export const addRewards = <G extends GenericFields>(
  state: G,
  roundRewards: readonly number[]
): G => ({
  ...state,
  rewards: state.rewards.map((r, i) => r + (roundRewards[i] ?? 0)),
})

/** Initialize the generic fields for a new game */
export const initGenericFields = (
  players: readonly Player[]
): GenericFields => ({
  status: "started" as GameStatus,
  round: 1,
  players: [...players],
  readyPlayers: [],
  rewards: players.map(() => 0),
})
```

- [ ] **Step 2: Write tests**

```typescript
// web/packages/effect-schemas/src/generic.test.ts
import { describe, it, expect } from "vitest"
import {
  updateStatus,
  addReadyPlayer,
  allPlayersReady,
  finishRound,
  addRewards,
  initGenericFields,
} from "./generic.js"
import type { PlayerId, GenericFields, GameStatus } from "./common.js"

// A fake game type to prove helpers preserve the concrete type
type FakeGame = GenericFields & { readonly type: "Fake"; readonly board: string[] }

const makeFakeGame = (): FakeGame => ({
  ...initGenericFields([
    { id: "p1" as PlayerId, name: "Alice" },
    { id: "p2" as PlayerId, name: "Bob" },
  ]),
  type: "Fake",
  board: ["", "", ""],
})

describe("generic helpers preserve concrete type", () => {
  it("updateStatus returns FakeGame, not GenericFields", () => {
    const game = makeFakeGame()
    const next = updateStatus(game, "betweenRounds")
    expect(next.type).toBe("Fake") // game-specific field preserved
    expect(next.board).toEqual(["", "", ""]) // game-specific field preserved
    expect(next.status).toBe("betweenRounds")
    expect(game.status).toBe("started") // original unchanged
  })

  it("addReadyPlayer is idempotent", () => {
    const game = makeFakeGame()
    const g2 = addReadyPlayer(game, "p1" as PlayerId)
    const g3 = addReadyPlayer(g2, "p1" as PlayerId)
    expect(g2.readyPlayers).toEqual(["p1"])
    expect(g3.readyPlayers).toEqual(["p1"])
    expect(g3.type).toBe("Fake") // still FakeGame
  })

  it("allPlayersReady checks all players", () => {
    const game = makeFakeGame()
    expect(allPlayersReady(game)).toBe(false)
    const g2 = addReadyPlayer(addReadyPlayer(game, "p1" as PlayerId), "p2" as PlayerId)
    expect(allPlayersReady(g2)).toBe(true)
  })

  it("finishRound increments and resets", () => {
    const game = updateStatus(makeFakeGame(), "betweenRounds")
    const next = finishRound(game)
    expect(next.round).toBe(2)
    expect(next.status).toBe("started")
    expect(next.readyPlayers).toEqual([])
    expect(next.board).toEqual(["", "", ""]) // preserved
  })

  it("addRewards accumulates", () => {
    const game = makeFakeGame()
    const r1 = addRewards(game, [5, 3])
    const r2 = addRewards(r1, [2, 7])
    expect(r2.rewards).toEqual([7, 10])
    expect(r2.type).toBe("Fake") // preserved
  })

  it("initGenericFields creates correct defaults", () => {
    const g = initGenericFields([{ id: "p1" as PlayerId, name: "A" }])
    expect(g.status).toBe("started")
    expect(g.round).toBe(1)
    expect(g.players).toHaveLength(1)
    expect(g.readyPlayers).toEqual([])
    expect(g.rewards).toEqual([0])
  })
})
```

- [ ] **Step 3: Update barrel export**

Add `export * from "./generic.js"` to `index.ts`.

- [ ] **Step 4: Run tests**

Run: `cd web/packages/effect-schemas && pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add web/packages/effect-schemas/
git commit -m "feat: add generic helper functions with structural type preservation"
```

---

## Task 3: Port Flylo schemas to Effect Schema (with GenericFields)

**Files:**
- Create: `web/packages/effect-schemas/src/flylo.ts`
- Test: `web/packages/effect-schemas/src/flylo.test.ts`
- Modify: `web/packages/effect-schemas/src/index.ts`

- [ ] **Step 1: Define Flylo schemas**

The key change: `FlyloGame` includes `GenericFields` fields directly via `Schema.extend`.

```typescript
// web/packages/effect-schemas/src/flylo.ts
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
```

- [ ] **Step 2: Write tests for Flylo schemas**

```typescript
// web/packages/effect-schemas/src/flylo.test.ts
import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { FlyloEvent, FlyloGame, GameCard } from "./flylo.js"
import type { PlayerId } from "./common.js"

describe("FlyloEvent discriminated union", () => {
  it("decodes draw event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "draw", fromDiscard: true })
    expect(e.kind).toBe("draw")
    if (e.kind === "draw") expect(e.fromDiscard).toBe(true)
  })

  it("decodes flip event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "flip", index: 3 })
    expect(e.kind).toBe("flip")
  })

  it("decodes discard event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "discard" })
    expect(e.kind).toBe("discard")
  })

  it("decodes replace event", () => {
    const e = Schema.decodeUnknownSync(FlyloEvent)({ kind: "replace", index: 5 })
    expect(e.kind).toBe("replace")
  })

  it("rejects unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(FlyloEvent)({ kind: "nope" })).toThrow()
  })
})

describe("GameCard", () => {
  it("defaults flipped to false", () => {
    const c = Schema.decodeUnknownSync(GameCard)({ number: "p5" })
    expect(c.flipped).toBe(false)
  })

  it("round-trips", () => {
    const c = Schema.decodeUnknownSync(GameCard)({ number: "m2", flipped: true })
    const json = Schema.encodeSync(GameCard)(c)
    const c2 = Schema.decodeUnknownSync(GameCard)(json)
    expect(c2).toEqual(c)
  })
})

describe("FlyloGame has GenericFields", () => {
  it("includes status, round, players, rewards as top-level fields", () => {
    const game = Schema.decodeUnknownSync(FlyloGame)({
      type: "Flylo",
      status: "started",
      round: 1,
      players: [{ id: "p1", name: "Alice" }],
      playerIds: ["p1"],
      flyloPlayers: [{ deck: { cards: [] }, card: null }],
      discardPile: { cards: [] },
      drawPile: { cards: [] },
      currentPlayerIndex: 0,
    })
    // Generic fields are directly on the object
    expect(game.status).toBe("started")
    expect(game.round).toBe(1)
    expect(game.players).toHaveLength(1)
    expect(game.readyPlayers).toEqual([])
    expect(game.rewards).toEqual([])
    // Game-specific fields also directly on the object
    expect(game.type).toBe("Flylo")
    expect(game.flyloPlayers).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Update barrel export, run tests, commit**

Run: `cd web/packages/effect-schemas && pnpm test`

```bash
git add web/packages/effect-schemas/
git commit -m "feat: add Flylo schemas extending GenericFields via intersection"
```

---

## Task 4: Port Flixx schemas to Effect Schema (with GenericFields)

**Files:**
- Create: `web/packages/effect-schemas/src/flixx.ts`
- Test: `web/packages/effect-schemas/src/flixx.test.ts`
- Modify: `web/packages/effect-schemas/src/index.ts`

- [ ] **Step 1: Define Flixx schemas**

Same pattern as Flylo. Port from `contracts/src/index.ts` (reference lines 90-120). Key types to port:

```typescript
// web/packages/effect-schemas/src/flixx.ts
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
```

- [ ] **Step 2: Write tests for Flixx event union and key types**

```typescript
// web/packages/effect-schemas/src/flixx.test.ts
import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { FlixxEvent, FlixxGame, FlixxRow, FlixxColor } from "./flixx.js"
import type { PlayerId } from "./common.js"

describe("FlixxEvent discriminated union", () => {
  it("decodes roll event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "roll" })
    expect(e.kind).toBe("roll")
  })

  it("decodes takeRoll event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "takeRoll", color: "red", index: 5 })
    expect(e.kind).toBe("takeRoll")
    if (e.kind === "takeRoll") {
      expect(e.color).toBe("red")
      expect(e.index).toBe(5)
    }
  })

  it("decodes pass event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "pass" })
    expect(e.kind).toBe("pass")
  })

  it("decodes takePenalty event", () => {
    const e = Schema.decodeUnknownSync(FlixxEvent)({ kind: "takePenalty" })
    expect(e.kind).toBe("takePenalty")
  })

  it("rejects unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(FlixxEvent)({ kind: "nope" })).toThrow()
  })
})

describe("FlixxGame has GenericFields", () => {
  it("includes status and round as top-level fields", () => {
    // FlixxGame has all the generic fields flat
    const game = Schema.decodeUnknownSync(FlixxGame)({
      type: "Flixx",
      status: "started",
      round: 1,
      players: [{ id: "p1", name: "Alice" }],
      flixxPlayers: {},
      currentPlayerIndex: 0,
    })
    expect(game.status).toBe("started")
    expect(game.round).toBe(1)
    expect(game.type).toBe("Flixx")
  })
})
```

- [ ] **Step 3: Update barrel export, run tests, commit**

```bash
git commit -m "feat: add Flixx schemas extending GenericFields via intersection"
```

---

## Task 5: Add API schemas and unified GameState

**Files:**
- Create: `web/packages/effect-schemas/src/api.ts`
- Modify: `web/packages/effect-schemas/src/index.ts`
- Test: `web/packages/effect-schemas/src/api.test.ts`

- [ ] **Step 1: Define unified GameState as discriminated union**

Both `FlyloGame` and `FlixxGame` extend `GenericFields`, so `GameState` is a union where every variant has `status`, `round`, `players`, etc. as top-level fields. The `type` field discriminates.

```typescript
// web/packages/effect-schemas/src/api.ts
import { Schema } from "effect"
import { PlayerId, GameCode, Player, GameConfig, GameStatus } from "./common.js"
import { FlyloGame, FlyloEvent } from "./flylo.js"
import { FlixxGame, FlixxEvent } from "./flixx.js"

// Discriminated on `type` field ("Flylo" | "Flixx")
// Both branches have GenericFields, so state.status, state.round, etc. always work
export const GameState = Schema.Union(FlyloGame, FlixxGame)
export type GameState = typeof GameState.Type

export const GameEvent = Schema.Union(FlyloEvent, FlixxEvent)
export type GameEvent = typeof GameEvent.Type

export const Lobby = Schema.Struct({
  code: GameCode,
  config: GameConfig,
  gameStatus: GameStatus,
  players: Schema.Array(Player),
})
export type Lobby = typeof Lobby.Type

// NOTE: This is an intentional redesign from the existing Zod schema.
// Existing had: creator: boolean (am I creator?), player: string, players: string[]
// New has: creator: PlayerId (who created it), player: Player, players: Player[]
// This is a breaking API change — the Dart backend must be updated to match,
// or a transform layer added in the Firebase service implementation.
export const GameInfo = Schema.Struct({
  gameID: GameCode,
  status: GameStatus,
  creator: PlayerId,
  config: GameConfig,
  player: Player,
  players: Schema.Array(Player),
})
export type GameInfo = typeof GameInfo.Type

// API Request/Response schemas
export const CreateGameRequest = Schema.Struct({ playerID: PlayerId, config: GameConfig })
export const CreateGameResponse = Schema.Struct({ code: GameCode })

export const JoinGameRequest = Schema.Struct({ code: GameCode, playerID: PlayerId, name: Schema.String })
export const JoinGameResponse = Schema.Struct({ name: Schema.String })

export const StartGameRequest = Schema.Struct({ code: GameCode, playerID: PlayerId })
export const StartGameResponse = Schema.Struct({ state: GameState })

export const SendEventRequest = Schema.Struct({ code: GameCode, playerID: PlayerId, event: GameEvent })
export const SendEventResponse = Schema.Struct({ state: GameState })

export const NextRoundRequest = Schema.Struct({ code: GameCode, playerID: PlayerId })
export const NextRoundResponse = Schema.Struct({ state: GameState })

export const DeleteGameRequest = Schema.Struct({ code: GameCode, playerID: PlayerId })
export const DeleteGameResponse = Schema.Struct({ success: Schema.Boolean })

export const GetGamesRequest = Schema.Struct({ playerID: PlayerId })
export const GetGamesResponse = Schema.Struct({ games: Schema.Array(GameInfo) })
```

- [ ] **Step 2: Write tests, run, commit**

```bash
git commit -m "feat: add API schemas and unified GameState type"
```

---

## Task 6: Bootstrap `game-engine` package with GameFunctions interface

**Files:**
- Create: `web/packages/game-engine/package.json`
- Create: `web/packages/game-engine/tsconfig.json`
- Create: `web/packages/game-engine/src/engine.ts`
- Create: `web/packages/game-engine/src/index.ts`
- Test: `web/packages/game-engine/src/engine.test.ts`

- [ ] **Step 1: Create package scaffolding**

```json
// web/packages/game-engine/package.json
{
  "name": "@games/game-engine",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@games/effect-schemas": "workspace:*",
    "effect": "^3.12.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Define GameFunctions interface and GameRegistry**

The key insight: `G extends GenericFields` means game logic functions can use generic helpers (updateStatus, addReadyPlayer, etc.) directly on their state without wrapping.

```typescript
// web/packages/game-engine/src/engine.ts
import { Effect } from "effect"
import type {
  GameConfig, GameType, Player, PlayerId,
  GenericFields, InvalidMove, GameError,
} from "@games/effect-schemas"

/**
 * GameFunctions defines the pure game logic contract.
 *
 * G extends GenericFields — the game state is a flat object with generic fields
 * (status, round, players, rewards, readyPlayers) plus game-specific fields.
 * This means game logic can use generic helpers like updateStatus(), addRewards()
 * directly on G without wrapping/unwrapping.
 *
 * E = game event type
 */
export interface GameFunctions<G extends GenericFields, E> {
  readonly gameType: GameType

  /** Create initial game state from config and players */
  readonly initialState: (
    config: GameConfig,
    players: readonly Player[]
  ) => Effect.Effect<G, InvalidMove>

  /** Process a player event, returning new state or typed error */
  readonly next: (
    state: G,
    config: GameConfig,
    playerId: PlayerId,
    event: E
  ) => Effect.Effect<G, InvalidMove | GameError>

  /** Advance to the next round */
  readonly nextRound: (
    state: G,
    config: GameConfig
  ) => Effect.Effect<G, GameError>

  /** Check if the current round is over */
  readonly isRoundOver: (state: G) => boolean

  /** Check if the entire game is over */
  readonly isGameOver: (state: G, config: GameConfig) => boolean
}

// --- Game Registry ---

const registry = new Map<string, GameFunctions<GenericFields, unknown>>()

export const GameRegistry = {
  register: <G extends GenericFields, E>(fns: GameFunctions<G, E>): void => {
    registry.set(fns.gameType, fns as unknown as GameFunctions<GenericFields, unknown>)
  },

  get: (gameType: GameType): GameFunctions<GenericFields, unknown> => {
    const fns = registry.get(gameType)
    if (!fns) throw new Error(`No game registered for type: ${gameType}`)
    return fns
  },

  has: (gameType: GameType): boolean => registry.has(gameType),

  registeredTypes: (): readonly string[] => [...registry.keys()],

  /** Reset registry (for testing) */
  clear: (): void => { registry.clear() },
} as const
```

- [ ] **Step 3: Write test for registry**

```typescript
// web/packages/game-engine/src/engine.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { GameRegistry, type GameFunctions } from "./engine.js"
import type { GenericFields, GameConfig, Player, PlayerId } from "@games/effect-schemas"
import { InvalidMove, initGenericFields } from "@games/effect-schemas"

// Minimal test game that extends GenericFields
type TestGame = GenericFields & { readonly type: "Flylo"; readonly board: readonly string[] }
interface TestEvent { readonly position: number }

const testFunctions: GameFunctions<TestGame, TestEvent> = {
  gameType: "Flylo",
  initialState: (_config, players) =>
    Effect.succeed({
      ...initGenericFields(players),
      type: "Flylo" as const,
      board: Array(9).fill(""),
    }),
  next: (state, _config, playerId, event) => {
    if (event.position < 0 || event.position > 8)
      return Effect.fail(new InvalidMove({ message: "Out of range", playerId }))
    const board = [...state.board]
    board[event.position] = playerId
    return Effect.succeed({ ...state, board })
  },
  nextRound: (state, _config) =>
    Effect.succeed({ ...state, board: Array(9).fill("") }),
  isRoundOver: (_state) => false,
  isGameOver: (_state) => false,
}

describe("GameRegistry", () => {
  beforeEach(() => GameRegistry.clear())

  it("registers and retrieves game functions", () => {
    GameRegistry.register(testFunctions)
    expect(GameRegistry.has("Flylo")).toBe(true)
    expect(GameRegistry.get("Flylo")).toBeDefined()
  })

  it("lists registered types", () => {
    GameRegistry.register(testFunctions)
    expect(GameRegistry.registeredTypes()).toContain("Flylo")
  })

  it("throws for unregistered type", () => {
    expect(() => GameRegistry.get("Flixx")).toThrow()
  })

  it("initialState includes generic fields", async () => {
    GameRegistry.register(testFunctions)
    const fns = GameRegistry.get("Flylo")
    const config = { gameType: "Flylo" as const, rounds: 1, minPlayers: 2, maxPlayers: 4, options: {} } as any
    const players = [{ id: "p1" as PlayerId, name: "A" }]
    const state = await Effect.runPromise(fns.initialState(config, players))
    // Generic fields are on the state directly
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(1)
    expect(state.rewards).toEqual([0])
  })
})
```

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: add game-engine package with GameFunctions<G extends GenericFields, E> and registry"
```

---

## Task 7: Port Flylo game logic to Effect

**Files:**
- Create: `web/packages/game-engine/src/flylo/deck.ts`
- Create: `web/packages/game-engine/src/flylo/logic.ts`
- Create: `web/packages/game-engine/src/flylo/index.ts`
- Test: `web/packages/game-engine/src/flylo/logic.test.ts`
- Modify: `web/packages/game-engine/src/index.ts`

Port the existing Flylo logic from `core-games/src/flylo/` but return `Effect<FlyloGame, GameError>` instead of `MaybeError<FlyloGame>`. Since `FlyloGame` now extends `GenericFields`, the game logic can call generic helpers like `updateStatus()` and `addRewards()` directly on the state.

- [ ] **Step 1: Port deck utilities**

Copy `web/packages/core-games/src/flylo/deck.ts` to `web/packages/game-engine/src/flylo/deck.ts`. Update imports: change `@games/contracts` types (`CardNum`, `GameCard`, `Deck`, etc.) to `@games/effect-schemas`. The deck utilities are pure functions — they stay as-is (no Effect wrapping needed for pure math).

- [ ] **Step 2: Write failing test for Flylo init**

```typescript
// web/packages/game-engine/src/flylo/logic.test.ts
import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { flyloFunctions } from "./logic.js"
import type { GameConfig, Player, PlayerId } from "@games/effect-schemas"

const config: GameConfig = {
  gameType: "Flylo",
  adminID: "p1" as PlayerId,
  rounds: 1,
  minPlayers: 2,
  maxPlayers: 4,
  options: { randomSeed: 42 },
}

const players: Player[] = [
  { id: "p1" as PlayerId, name: "Alice" },
  { id: "p2" as PlayerId, name: "Bob" },
]

describe("flyloFunctions.initialState", () => {
  it("creates valid initial state with generic fields", async () => {
    const state = await Effect.runPromise(flyloFunctions.initialState(config, players))
    // Game-specific
    expect(state.type).toBe("Flylo")
    expect(state.playerIds).toEqual(["p1", "p2"])
    expect(state.flyloPlayers).toHaveLength(2)
    expect(state.flyloPlayers[0]!.deck.cards).toHaveLength(12)
    expect(state.flyloPlayers[1]!.deck.cards).toHaveLength(12)
    expect(state.drawPile.cards).toHaveLength(125) // 150 - 24 dealt - 1 discard
    expect(state.discardPile.cards).toHaveLength(1)
    expect(state.discardPile.cards[0]!.flipped).toBe(true)
    // Generic fields — directly on the state, not nested
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(2)
    expect(state.rewards).toEqual([0, 0])
    expect(state.readyPlayers).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web/packages/game-engine && pnpm test -- flylo`
Expected: FAIL — module not found

- [ ] **Step 4: Implement flyloFunctions**

Port `initFlylo`, `nextFlylo`, `nextRoundFlylo`, `isRoundOverFlylo`, `isGameOverFlylo` from `core-games/src/flylo/flylo.ts`. Key changes:

- `initialState` spreads `initGenericFields(players)` into the FlyloGame object
- `nextFlylo` returns `Effect.Effect<FlyloGame, InvalidMove | NotYourTurn>` instead of `MaybeError<FlyloGame>`
- Replace `return err("message")` with `yield* Effect.fail(new InvalidMove({ message, playerId }))`
- Replace `return ok(newState)` with `return newState` (inside `Effect.gen`)
- Turn validation uses `NotYourTurn` error instead of string
- Event switch uses `event.kind` (matching existing code)
- Generic helpers like `updateStatus()`, `addRewards()`, `finishRound()` work directly on FlyloGame

```typescript
// web/packages/game-engine/src/flylo/logic.ts (abbreviated structure)
import { Effect } from "effect"
import type { GameFunctions } from "../engine.js"
import type { FlyloGame, FlyloEvent, GameConfig, Player, PlayerId } from "@games/effect-schemas"
import { InvalidMove, NotYourTurn, initGenericFields, updateStatus, addRewards } from "@games/effect-schemas"
import { allCards, shuffleDeck, drawFromDeck, /* ... */ } from "./deck.js"

export const flyloFunctions: GameFunctions<FlyloGame, FlyloEvent> = {
  gameType: "Flylo",

  initialState: (config, players) =>
    Effect.gen(function* () {
      const seed = config.options.randomSeed as number | undefined
      const deck = shuffleDeck({ cards: allCards() }, seed)
      // ... deal cards, set up state (same logic as existing initFlylo)
      return {
        ...initGenericFields(players),  // spreads status, round, players, rewards, readyPlayers
        type: "Flylo" as const,
        playerIds: players.map(p => p.id),
        flyloPlayers: dealt,
        drawPile, discardPile,
        currentPlayerIndex: 0,
        firstPlayerOutIndex: null,
        debug: false,
      }
    }),

  next: (state, config, playerId, event) =>
    Effect.gen(function* () {
      // Validate turn (use NotYourTurn error)
      // Switch on event.kind (not event.type — matches existing code)
      switch (event.kind) {
        case "draw": return yield* handleDraw(state, playerId, event)
        case "flip": return yield* handleFlip(state, config, playerId, event)
        case "discard": return yield* handleDiscard(state, playerId)
        case "replace": return yield* handleReplace(state, config, playerId, event)
      }
    }),

  nextRound: (state, config) =>
    Effect.gen(function* () {
      // Uses generic helpers directly on FlyloGame:
      const withRewards = addRewards(state, calculateRoundRewards(state))
      const reset = finishRound(withRewards) // increments round, resets readyPlayers
      // Re-deal cards...
      return { ...reset, flyloPlayers: dealt, drawPile, discardPile, ... }
    }),

  isRoundOver: (state) => {
    // existing logic — checks firstPlayerOutIndex and all flipped
    return state.firstPlayerOutIndex !== null && state.flyloPlayers.every(isEndCondition)
  },

  isGameOver: (state, config) => {
    const threshold = (config.options.winThreshold as number) ?? 100
    return state.flyloPlayers.some((p) => p.currentScore >= threshold)
  },
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web/packages/game-engine && pnpm test -- flylo`
Expected: All pass

- [ ] **Step 6: Port remaining Flylo tests from core-games**

Copy and adapt tests from `web/packages/core-games/src/flylo.test.ts`. Change `ok`/`err` checks to `Effect.runPromise` (success) and `Effect.runPromiseExit` (failure with typed error inspection).

- [ ] **Step 7: Run full test suite, commit**

```bash
git commit -m "feat: port Flylo game logic to Effect with typed errors and GenericFields"
```

---

## Task 8: Port Flixx game logic to Effect

**Files:**
- Create: `web/packages/game-engine/src/flixx/logic.ts`
- Create: `web/packages/game-engine/src/flixx/index.ts`
- Test: `web/packages/game-engine/src/flixx/logic.test.ts`
- Modify: `web/packages/game-engine/src/index.ts`

Same pattern as Task 7. Port `initFlixx`, `nextFlixx`, `nextRoundFlixx`, `isRoundOverFlixx`, `isGameOverFlixx` from `core-games/src/flixx/flixx.ts`.

Key Flixx-specific concerns:
- Row direction logic (`LOW_TO_HIGH` map): red/yellow go 2→12, green/blue/purple go 12→2
- Lock conditions: auto-lock when reaching end position with 5+ marks
- Dice validation: current player can use white sum OR colored+white, other players only white sum
- `event.kind` discriminator (matching existing code)
- `FlixxGame` extends `GenericFields` so `updateStatus()`, `addRewards()` work directly

- [ ] **Step 1: Write failing tests for Flixx init and core events**

```typescript
// web/packages/game-engine/src/flixx/logic.test.ts
import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { flixxFunctions } from "./logic.js"
import type { GameConfig, Player, PlayerId, FlixxEvent } from "@games/effect-schemas"

const config: GameConfig = {
  gameType: "Flixx",
  adminID: "p1" as PlayerId,
  rounds: 1, minPlayers: 2, maxPlayers: 4,
  options: { randomSeed: 42 },
}

const players: Player[] = [
  { id: "p1" as PlayerId, name: "Alice" },
  { id: "p2" as PlayerId, name: "Bob" },
]

describe("flixxFunctions.initialState", () => {
  it("creates valid initial state with generic fields", async () => {
    const state = await Effect.runPromise(flixxFunctions.initialState(config, players))
    expect(state.type).toBe("Flixx")
    // Generic fields
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(2)
    expect(state.rewards).toEqual([0, 0])
    // Flixx-specific
    expect(Object.keys(state.flixxPlayers)).toHaveLength(2)
    expect(state.rolled).toBe(false)
    // currentRoll may be null or a pre-rolled value depending on implementation
    // The existing Dart/TS code pre-rolls; the new code can choose either approach
  })
})

describe("flixxFunctions.next", () => {
  it("rejects roll from non-current player", async () => {
    const state = await Effect.runPromise(flixxFunctions.initialState(config, players))
    const wrongPlayer = state.players[1]!.id
    const event: FlixxEvent = { kind: "roll" }
    const exit = await Effect.runPromiseExit(
      flixxFunctions.next(state, config, wrongPlayer, event)
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("allows current player to roll", async () => {
    const state = await Effect.runPromise(flixxFunctions.initialState(config, players))
    const currentPlayer = state.players[state.currentPlayerIndex]!.id
    const event: FlixxEvent = { kind: "roll" }
    const next = await Effect.runPromise(
      flixxFunctions.next(state, config, currentPlayer, event)
    )
    expect(next.rolled).toBe(true)
    expect(next.currentRoll).not.toBeNull()
  })
})
```

- [ ] **Step 2: Implement flixxFunctions following GameFunctions interface**

Port from `core-games/src/flixx/flixx.ts`. Same transformation pattern as Flylo:
- Spread `initGenericFields(players)` into initial state
- Replace `MaybeError` returns with `Effect.succeed`/`Effect.fail`
- Use `NotYourTurn`/`InvalidMove` typed errors
- Switch on `event.kind`

- [ ] **Step 3: Port remaining Flixx tests from core-games**

Adapt tests from `web/packages/core-games/src/flixx.test.ts`.

- [ ] **Step 4: Run full test suite, commit**

```bash
git commit -m "feat: port Flixx game logic to Effect with typed errors and GenericFields"
```

---

## Task 9: Register games and add integration tests

**Files:**
- Create: `web/packages/game-engine/src/register.ts`
- Modify: `web/packages/game-engine/src/index.ts`
- Test: `web/packages/game-engine/src/integration.test.ts`

- [ ] **Step 1: Create registration module**

```typescript
// web/packages/game-engine/src/register.ts
import { GameRegistry } from "./engine.js"
import { flyloFunctions } from "./flylo/index.js"
import { flixxFunctions } from "./flixx/index.js"

export const registerAllGames = (): void => {
  GameRegistry.register(flyloFunctions)
  GameRegistry.register(flixxFunctions)
}
```

- [ ] **Step 2: Write integration test — full game lifecycle through registry**

```typescript
// web/packages/game-engine/src/integration.test.ts
import { describe, it, expect, beforeAll } from "vitest"
import { Effect } from "effect"
import { GameRegistry } from "./engine.js"
import { registerAllGames } from "./register.js"
import type { PlayerId, GameConfig, Player, FlyloEvent } from "@games/effect-schemas"
import { updateStatus, addReadyPlayer } from "@games/effect-schemas"

beforeAll(() => {
  GameRegistry.clear()
  registerAllGames()
})

describe("Game lifecycle via registry", () => {
  const config: GameConfig = {
    gameType: "Flylo",
    adminID: "p1" as PlayerId,
    rounds: 1, minPlayers: 2, maxPlayers: 4,
    options: { randomSeed: 42 },
  }

  const players: Player[] = [
    { id: "p1" as PlayerId, name: "Alice" },
    { id: "p2" as PlayerId, name: "Bob" },
  ]

  it("creates initial state via registry dispatch", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    expect(state).toBeDefined()
    // Generic fields are accessible directly
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
  })

  it("generic helpers work on registry-returned state", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    // updateStatus works on the state from the registry
    const paused = updateStatus(state, "betweenRounds")
    expect(paused.status).toBe("betweenRounds")
    // addReadyPlayer works
    const ready = addReadyPlayer(paused, "p1" as PlayerId)
    expect(ready.readyPlayers).toEqual(["p1"])
  })

  it("processes event via registry dispatch", async () => {
    const fns = GameRegistry.get("Flylo")
    const state = await Effect.runPromise(fns.initialState(config, players))
    const event = { kind: "flip", index: 0 } as FlyloEvent
    const next = await Effect.runPromise(
      fns.next(state, config, "p1" as PlayerId, event)
    )
    expect(next).toBeDefined()
  })

  it("both game types are registered", () => {
    expect(GameRegistry.has("Flylo")).toBe(true)
    expect(GameRegistry.has("Flixx")).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: add game registration and integration tests"
```

---

## Task 10: Define service layer with Effect Layer/Context

**Files:**
- Create: `web/packages/game-services/package.json`
- Create: `web/packages/game-services/tsconfig.json`
- Create: `web/packages/game-services/src/GameService.ts`
- Create: `web/packages/game-services/src/RoundService.ts`
- Create: `web/packages/game-services/src/index.ts`

- [ ] **Step 1: Create package scaffolding**

```json
{
  "name": "@games/game-services",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@games/effect-schemas": "workspace:*",
    "@games/game-engine": "workspace:*",
    "effect": "^3.12.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Define GameService tag**

```typescript
// web/packages/game-services/src/GameService.ts
import { Context, Effect } from "effect"
import type {
  GameCode, PlayerId, GameConfig, GameInfo,
  GameNotFound, GameFull, NotAdmin,
} from "@games/effect-schemas"

export interface GameServiceApi {
  readonly createGame: (
    playerId: PlayerId, config: GameConfig
  ) => Effect.Effect<GameCode, never>

  readonly joinGame: (
    playerId: PlayerId, code: GameCode, name: string
  ) => Effect.Effect<string, GameNotFound | GameFull>

  readonly deleteGame: (
    playerId: PlayerId, code: GameCode
  ) => Effect.Effect<boolean, GameNotFound | NotAdmin>

  readonly getGames: (
    playerId: PlayerId
  ) => Effect.Effect<readonly GameInfo[]>
}

export class GameService extends Context.Tag("GameService")<
  GameService, GameServiceApi
>() {}
```

- [ ] **Step 3: Define RoundService tag**

The `GameState` type in the service interface already has `GenericFields` — callers can access `state.status`, `state.round`, etc. without knowing which game type it is.

```typescript
// web/packages/game-services/src/RoundService.ts
import { Context, Effect, Stream } from "effect"
import type {
  GameCode, PlayerId, GameState, GameEvent, GameError,
  GameNotFound, NotAdmin, Lobby,
} from "@games/effect-schemas"

export interface RoundServiceApi {
  readonly startGame: (
    playerId: PlayerId, code: GameCode
  ) => Effect.Effect<GameState, GameNotFound | NotAdmin>

  readonly sendEvent: (
    playerId: PlayerId, code: GameCode, event: GameEvent
  ) => Effect.Effect<GameState, GameError | GameNotFound>

  readonly nextRound: (
    playerId: PlayerId, code: GameCode
  ) => Effect.Effect<GameState, GameError | GameNotFound>

  readonly gameStream: (
    code: GameCode
  ) => Stream.Stream<GameState, GameNotFound>

  readonly lobbyStream: (
    code: GameCode
  ) => Stream.Stream<Lobby, GameNotFound>
}

export class RoundService extends Context.Tag("RoundService")<
  RoundService, RoundServiceApi
>() {}
```

- [ ] **Step 4: Create barrel export, commit**

```bash
git commit -m "feat: add game-services package with service interfaces as Effect tags"
```

---

## Task 11: Implement MockGameService Layer

**Files:**
- Create: `web/packages/game-services/src/MockGameService.ts`
- Create: `web/packages/game-services/src/MockRoundService.ts`
- Test: `web/packages/game-services/src/mock.test.ts`

This replaces `mockBackend.ts`. All game logic runs in-memory using the `GameRegistry`.

- [ ] **Step 1: Implement MockGameService Layer**

```typescript
// web/packages/game-services/src/MockGameService.ts
import { Effect, Layer, Ref } from "effect"
import { GameService } from "./GameService.js"
import type { GameCode, PlayerId, GameConfig } from "@games/effect-schemas"
import { GameNotFound, GameFull, NotAdmin } from "@games/effect-schemas"

interface Room {
  readonly code: GameCode
  readonly config: GameConfig
  readonly players: ReadonlyArray<{ id: PlayerId; name: string }>
  readonly state: unknown | null
}

export const MockGameServiceLive = Layer.effect(
  GameService,
  Effect.gen(function* () {
    const rooms = yield* Ref.make<ReadonlyMap<string, Room>>(new Map())

    return {
      createGame: (playerId, config) =>
        Effect.gen(function* () {
          const code = generateCode() as GameCode
          yield* Ref.update(rooms, (m) => {
            const next = new Map(m)
            next.set(code, {
              code,
              config: { ...config, adminID: playerId },
              players: [{ id: playerId, name: "" }],
              state: null,
            })
            return next
          })
          return code
        }),

      joinGame: (playerId, code, name) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          const room = map.get(code)
          if (!room) return yield* Effect.fail(new GameNotFound({ code }))
          if (room.players.length >= room.config.maxPlayers)
            return yield* Effect.fail(new GameFull({ code, maxPlayers: room.config.maxPlayers }))
          yield* Ref.update(rooms, (m) => {
            const next = new Map(m)
            const r = next.get(code)!
            next.set(code, { ...r, players: [...r.players, { id: playerId, name }] })
            return next
          })
          return name
        }),

      deleteGame: (playerId, code) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          const room = map.get(code)
          if (!room) return yield* Effect.fail(new GameNotFound({ code }))
          if (room.config.adminID !== playerId)
            return yield* Effect.fail(new NotAdmin({ playerId }))
          yield* Ref.update(rooms, (m) => {
            const next = new Map(m)
            next.delete(code)
            return next
          })
          return true
        }),

      getGames: (playerId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(rooms)
          return [...map.values()]
            .filter((r) => r.players.some((p) => p.id === playerId))
            .map((r) => ({
              gameID: r.code,
              status: r.state ? "started" as const : "lobby" as const,
              creator: r.config.adminID!,
              config: r.config,
              player: r.players.find((p) => p.id === playerId)!,
              players: r.players.map((p) => ({ id: p.id, name: p.name })),
            }))
        }),
    }
  })
)

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * 26)]).join("")
}
```

- [ ] **Step 2: Write tests for MockGameService**

```typescript
// web/packages/game-services/src/mock.test.ts
import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { GameService } from "./GameService.js"
import { MockGameServiceLive } from "./MockGameService.js"
import type { PlayerId, GameConfig, GameCode } from "@games/effect-schemas"

const runWithMock = <A, E>(effect: Effect.Effect<A, E, GameService>) =>
  Effect.runPromiseExit(Effect.provide(effect, MockGameServiceLive))

const config: GameConfig = {
  gameType: "Flylo", rounds: 1, minPlayers: 2, maxPlayers: 4, options: {},
} as any

describe("MockGameService", () => {
  it("creates and joins a game", async () => {
    const exit = await runWithMock(
      Effect.gen(function* () {
        const svc = yield* GameService
        const code = yield* svc.createGame("p1" as PlayerId, config)
        const name = yield* svc.joinGame("p2" as PlayerId, code, "Bob")
        expect(name).toBe("Bob")
        const games = yield* svc.getGames("p1" as PlayerId)
        expect(games).toHaveLength(1)
        expect(games[0]!.players).toHaveLength(2)
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("fails to join nonexistent game", async () => {
    const exit = await runWithMock(
      Effect.gen(function* () {
        const svc = yield* GameService
        yield* svc.joinGame("p1" as PlayerId, "XXXX" as GameCode, "Alice")
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails to delete game as non-admin", async () => {
    const exit = await runWithMock(
      Effect.gen(function* () {
        const svc = yield* GameService
        const code = yield* svc.createGame("p1" as PlayerId, config)
        yield* svc.deleteGame("p2" as PlayerId, code) // p2 is not admin
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

- [ ] **Step 3: Implement MockRoundService Layer**

Uses `Ref` for in-memory state, `GameRegistry` for game logic dispatch. The state returned from the registry already has `GenericFields` — the service just stores and returns it.

- [ ] **Step 4: Write tests for MockRoundService**

Test: start → sendEvent → verify state changes → nextRound. Verify that `state.status`, `state.round` update correctly through the lifecycle.

- [ ] **Step 5: Run full test suite, commit**

```bash
git commit -m "feat: implement mock game and round services with Effect Layer"
```

---

## Task 12: Implement FirebaseGameService Layer (stub)

**Files:**
- Create: `web/packages/game-services/src/HttpClient.ts`
- Create: `web/packages/game-services/src/FirebaseGameService.ts`
- Create: `web/packages/game-services/src/FirebaseRoundService.ts`

- [ ] **Step 1: Define HttpClient service tag**

```typescript
// web/packages/game-services/src/HttpClient.ts
import { Context, Effect, Data, Schema } from "effect"

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number
  readonly message: string
}> {}

export class HttpClient extends Context.Tag("HttpClient")<
  HttpClient,
  {
    readonly post: <A>(
      path: string,
      body: unknown,
      responseSchema: Schema.Schema<A>
    ) => Effect.Effect<A, HttpError>
  }
>() {}
```

- [ ] **Step 2: Implement FirebaseGameService using HttpClient tag**

Each method encodes the request with Schema, posts via HttpClient, and decodes the response.

- [ ] **Step 3: Implement FirebaseRoundService**

Uses `Stream.repeatEffect` + `Schedule.spaced("2500 millis")` for polling game state updates, replacing the manual `setInterval`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add Firebase service layers using Effect HttpClient"
```

---

## Task 13a: Create React atoms and runtime

**Files:**
- Create: `web/apps/web/src/atoms/runtime.ts`
- Create: `web/apps/web/src/atoms/game.ts`
- Create: `web/apps/web/src/atoms/session.ts`

- [ ] **Step 1: Install @effect-atom/atom-react**

```bash
cd web/apps/web && pnpm add @effect-atom/atom-react effect
```

- [ ] **Step 2: Create runtime atom**

```typescript
// web/apps/web/src/atoms/runtime.ts
import { Atom } from "@effect-atom/atom-react"
import { Layer } from "effect"
import { GameService, RoundService } from "@games/game-services"
import { MockGameServiceLive, MockRoundServiceLive } from "@games/game-services"

// Swap this for FirebaseLayer in production
const AppLayer = Layer.merge(MockGameServiceLive, MockRoundServiceLive)

export const runtimeAtom = Atom.runtime(AppLayer)
```

- [ ] **Step 3: Create game state atoms**

```typescript
// web/apps/web/src/atoms/game.ts
import { Effect } from "effect"
import { runtimeAtom } from "./runtime.js"
import { GameService, RoundService } from "@games/game-services"
import type { GameCode, PlayerId, GameConfig, GameEvent } from "@games/effect-schemas"

export const createGameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (input: { playerId: PlayerId; config: GameConfig }) {
    const svc = yield* GameService
    return yield* svc.createGame(input.playerId, input.config)
  })
)

export const joinGameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (input: { playerId: PlayerId; code: GameCode; name: string }) {
    const svc = yield* GameService
    return yield* svc.joinGame(input.playerId, input.code, input.name)
  })
)

export const startGameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (input: { playerId: PlayerId; code: GameCode }) {
    const svc = yield* RoundService
    return yield* svc.startGame(input.playerId, input.code)
  })
)

export const sendEventAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (input: { playerId: PlayerId; code: GameCode; event: GameEvent }) {
    const svc = yield* RoundService
    return yield* svc.sendEvent(input.playerId, input.code, input.event)
  })
)

export const nextRoundAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (input: { playerId: PlayerId; code: GameCode }) {
    const svc = yield* RoundService
    return yield* svc.nextRound(input.playerId, input.code)
  })
)
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add Effect atoms for React state management"
```

---

## Task 13b: Migrate HomeView and LobbyView to atoms

**Files:**
- Create: `web/apps/web/src/components/HomeView.tsx`
- Create: `web/apps/web/src/components/LobbyView.tsx`
- Modify: `web/apps/web/src/App.tsx` (extract views, wire up atoms)

- [ ] **Step 1: Extract HomeView component**

Move the HomeView JSX from `App.tsx` into `components/HomeView.tsx`. Replace `gateway.createGame(...)` with `useAtomSet(createGameAtom)`, `gateway.joinGame(...)` with `useAtomSet(joinGameAtom)`. Replace `useMyGames` hook with an atom subscribing to `GameService.getGames`.

- [ ] **Step 2: Extract LobbyView component**

Move LobbyView JSX. Replace gateway calls with atoms. The lobby stream uses `runtimeAtom.atom(...)` subscribing to `RoundService.lobbyStream`.

- [ ] **Step 3: Update App.tsx to import extracted components**

- [ ] **Step 4: Verify app renders correctly**

```bash
cd web/apps/web && pnpm test && pnpm dev
# Manual check: can create/join game, lobby shows players
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: migrate HomeView and LobbyView to Effect atoms"
```

---

## Task 13c: Migrate FlyloView and FlixxView to atoms

**Files:**
- Create: `web/apps/web/src/components/FlyloView.tsx`
- Create: `web/apps/web/src/components/FlixxView.tsx`
- Modify: `web/apps/web/src/App.tsx`

- [ ] **Step 1: Extract FlyloView**

Move Flylo game UI from `App.tsx`. Replace `gateway.sendEvent(...)` with `useAtomSet(sendEventAtom)`. Replace `useRoomSnapshot` with an atom subscribing to `RoundService.gameStream`. Since the game state has `GenericFields` flat, the view accesses `state.status`, `state.round`, `state.players` directly — same as before.

Error display: use `Exit.isFailure(exit)` to check for errors and `Cause.failureOption` to extract the typed error. Display `error._tag` + `error.message` for `InvalidMove`, `"Not your turn"` for `NotYourTurn`.

- [ ] **Step 2: Extract FlixxView**

Same pattern.

- [ ] **Step 3: Update App.tsx**

- [ ] **Step 4: Verify all game views work**

```bash
cd web/apps/web && pnpm test && pnpm dev
# Manual check: play through a Flylo and Flixx game
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: migrate FlyloView and FlixxView to Effect atoms"
```

---

## Task 13d: Remove old gateway files

**Files:**
- Remove: `web/apps/web/src/lib/gateway.ts`
- Remove: `web/apps/web/src/lib/gameGateway.ts`
- Remove: `web/apps/web/src/lib/functionsGateway.ts`
- Remove: `web/apps/web/src/lib/mockBackend.ts`

- [ ] **Step 1: Verify no imports remain**

```bash
cd web && grep -r "gateway\|gameGateway\|functionsGateway\|mockBackend" apps/web/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: No matches (or only the files being deleted).

- [ ] **Step 2: Delete old gateway files**

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "refactor: remove legacy gateway files, replaced by Effect services"
```

---

## Task 14: Remove old `contracts` and `core-games` packages

**Files:**
- Remove: `web/packages/contracts/`
- Remove: `web/packages/core-games/`
- Modify: `web/pnpm-workspace.yaml` (add new packages if not already listed)
- Modify: `web/tsconfig.base.json` (update paths)

- [ ] **Step 1: Verify no imports of old packages remain**

```bash
cd web && grep -r "@games/contracts\|@games/core-games" --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v packages/contracts | grep -v packages/core-games
```

Expected: No matches.

- [ ] **Step 2: Update workspace paths**

In `web/tsconfig.base.json`, replace:
- `@games/contracts` → `@games/effect-schemas`
- `@games/core-games` → `@games/game-engine`

Add `@games/game-services` path.

- [ ] **Step 3: Delete old packages**

```bash
rm -rf web/packages/contracts web/packages/core-games
```

- [ ] **Step 4: Verify everything builds and tests pass**

```bash
cd web && pnpm install && pnpm -r test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: remove legacy contracts and core-games packages"
```

---

## Task 15: Port backend to Effect-based Cloud Functions (deferred)

**Files:**
- Create: `web/apps/backend/` (new TypeScript Cloud Functions)
- Reference: `backend/lib/functions.dart` (existing Dart backend)

This task is deferred — it depends on whether you want to keep the Dart backend temporarily while the frontend migrates, or replace it simultaneously.

- [ ] **Step 1: Create backend package with Effect**

Firebase Cloud Functions v2 in TypeScript. Each endpoint is a thin shell that decodes the request with Schema, runs an Effect program with the service layer, and encodes the response.

- [ ] **Step 2: Implement endpoints**

`createGame`, `joinGame`, `startGame`, `sendEvent`, `nextRound`, `deleteGame`, `getGames` — each delegates to `GameService` / `RoundService` provided via a Firebase-backed Layer.

- [ ] **Step 3: Deploy and test**

---

## Summary of what this achieves

| Before | After |
|--------|-------|
| Ad-hoc `MaybeError<T>` with no composition | `Effect<A, E>` with typed error channel, `catchTag`, `flatMap` |
| Zod schemas (parse-only) | Effect Schema (bidirectional encode/decode, branded types) |
| No generic game abstraction | `GameFunctions<G extends GenericFields, E>` + `GameRegistry` |
| No shared fields across games | `GenericFields` as intersection — `state.status` works on any game |
| Dart-style nested wrapper (`state.generic.status`) | Flat structural typing (`state.status`) — TypeScript-native |
| Generic helpers lose concrete type | `<G extends GenericFields>` preserves exact game type through spread |
| No `betweenRounds` status | Full `GameStatus` lifecycle matching Dart |
| Manual gateway if/else for mock vs Firebase | `Layer` DI — swap `MockLayer` for `FirebaseLayer` |
| Duplicate event-application in mock + functions gateways | Single `RoundService` interface, two Layer implementations |
| No service layer abstraction | `GameService` + `RoundService` as Effect `Context.Tag` |
| String errors | `Data.TaggedError` hierarchy with exhaustive `catchTag` handling |
| 518-line monolithic App.tsx | Extracted view components with atoms |
