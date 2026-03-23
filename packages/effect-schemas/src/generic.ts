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
