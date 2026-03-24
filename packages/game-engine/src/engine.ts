import { Effect } from "effect"
import type {
  GameConfig, GameType, Player, PlayerId,
  GenericFields, InvalidMove, GameError,
  StatEntry,
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

  /** Generate stat entries when a round ends. Called by backend after detecting round over. */
  readonly onRoundEnd?: (prevState: G, newState: G, config: GameConfig) => StatEntry[]

  /** Generate stat entries when the game ends. Called by backend after detecting game over. */
  readonly onGameEnd?: (state: G, config: GameConfig) => StatEntry[]
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
