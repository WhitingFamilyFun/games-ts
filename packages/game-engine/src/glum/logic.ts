/**
 * Glum game logic — Effect-based.
 * Card game where players try to get rid of all their cards (President / Scum style).
 */

import { Effect } from "effect"
import type {
  FaceCard,
  FaceValue,
  GlumEvent,
  GlumGame,
  GlumPlayer,
  GlumSet,
  GameConfig,
  Player,
  PlayerId,
  StatEntry,
} from "@games/effect-schemas"
import { InvalidMove, NotYourTurn, initGenericFields } from "@games/effect-schemas"
import type { GameFunctions } from "../engine.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROUNDS = 4

const FACE_VALUE_MAP: Record<FaceValue, number> = {
  ace: 14,
  king: 13,
  queen: 12,
  jack: 11,
  ten: 10,
  nine: 9,
  eight: 8,
  seven: 7,
  six: 6,
  five: 5,
  four: 4,
  three: 3,
  two: 2,
}

// ---------------------------------------------------------------------------
// Seeded RNG (same mulberry32 as fireworks/flylo)
// ---------------------------------------------------------------------------

function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], seed?: number): T[] {
  const result = [...arr]
  const rand = seed !== undefined ? seededRng(seed) : Math.random.bind(Math)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

export function cardValue(card: FaceCard): number {
  if (card.kind === "joker") return 100
  return FACE_VALUE_MAP[card.value]
}

function setValue(set: GlumSet): number {
  // If there's a declaredValue, use it (for all-joker sets)
  if (set.declaredValue) return cardValue(set.declaredValue)
  // Otherwise find the first non-joker card
  for (const c of set.cards) {
    if (c.kind === "normal") return cardValue(c)
  }
  // All jokers with no declared value — shouldn't happen, treat as 100
  return 100
}

function cardsEqual(a: FaceCard, b: FaceCard): boolean {
  if (a.kind === "joker" && b.kind === "joker") return true
  if (a.kind === "normal" && b.kind === "normal") {
    return a.suit === b.suit && a.value === b.value
  }
  return false
}

/**
 * Validate a GlumSet: all cards must be the same value (jokers are wild).
 */
function isValidSet(set: GlumSet): boolean {
  if (set.cards.length === 0) return false
  const nonJokers = set.cards.filter(c => c.kind === "normal")
  if (nonJokers.length === 0) {
    // All jokers — must have declaredValue
    return set.declaredValue !== null && set.declaredValue !== undefined
  }
  // All non-joker cards must have same value
  const first = nonJokers[0]!
  return nonJokers.every(c => c.kind === "normal" && c.value === first.value)
}

/**
 * Check if a player's hand contains all the cards in a set.
 * Returns the indices of the matching cards, or null if not found.
 */
function findCardsInHand(hand: readonly FaceCard[], cards: readonly FaceCard[]): number[] | null {
  const indices: number[] = []
  const used = new Set<number>()
  for (const card of cards) {
    let found = false
    for (let i = 0; i < hand.length; i++) {
      if (!used.has(i) && cardsEqual(hand[i]!, card)) {
        indices.push(i)
        used.add(i)
        found = true
        break
      }
    }
    if (!found) return null
  }
  return indices
}

function removeCardsAtIndices(hand: readonly FaceCard[], indices: number[]): FaceCard[] {
  const indexSet = new Set(indices)
  return hand.filter((_, i) => !indexSet.has(i))
}

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

function makeDeck(numDecks: number): FaceCard[] {
  const suits = ["clubs", "spades", "hearts", "diamonds"] as const
  const values: FaceValue[] = [
    "ace", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "jack", "queen", "king",
  ]
  const cards: FaceCard[] = []
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const value of values) {
        cards.push({ kind: "normal", suit, value })
      }
    }
    // 2 jokers per deck
    cards.push({ kind: "joker" })
    cards.push({ kind: "joker" })
  }
  return cards
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initGlum(
  players: readonly Player[],
  config: GameConfig,
): GlumGame {
  const seed = config.options["randomSeed"] as number | undefined
  const numDecks = players.length >= 5 ? 2 : 1
  const deck = shuffle(makeDeck(numDecks), seed)

  // Deal cards evenly
  const numPlayers = players.length
  const cardsPerPlayer = Math.floor(deck.length / numPlayers)
  const glumPlayers: GlumPlayer[] = players.map((_, i) => ({
    deck: deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer),
    passed: false,
  }))

  // Skip trading — mark all players as finishedSetup
  const finishedSetup = players.map((_, i) => i)

  return {
    ...initGenericFields(players),
    type: "Glum",
    playerIds: players.map(p => p.id),
    glumPlayers,
    pile: { sets: [] },
    currentPlayerIndex: 0,
    outIndex: [],
    finishedSetup,
  }
}

// ---------------------------------------------------------------------------
// Turn logic
// ---------------------------------------------------------------------------

function nextGlum(
  state: GlumGame,
  _config: GameConfig,
  playerId: PlayerId,
  event: GlumEvent,
): Effect.Effect<GlumGame, InvalidMove | NotYourTurn> {
  return Effect.gen(function* () {
    if (isRoundOverGlum(state)) {
      return yield* Effect.fail(new InvalidMove({ message: "Round is over", playerId }))
    }

    const playerIdx = state.playerIds.indexOf(playerId)
    if (playerIdx === -1) {
      return yield* Effect.fail(new InvalidMove({ message: "Player not found", playerId }))
    }

    // Give event doesn't require it to be your turn
    if (event.kind === "glum_give") {
      return yield* handleGive(state, playerIdx, playerId, event.toPlayer, event.cards)
    }

    if (state.currentPlayerIndex !== playerIdx) {
      return yield* Effect.fail(
        new NotYourTurn({
          playerId,
          currentPlayerId: state.playerIds[state.currentPlayerIndex]!,
        })
      )
    }

    switch (event.kind) {
      case "glum_playSet":
        return yield* handlePlaySet(state, playerIdx, playerId, event.glumSet)
      case "glum_pass":
        return yield* handlePass(state, playerIdx, playerId)
    }
  })
}

// ---------------------------------------------------------------------------
// Play Set
// ---------------------------------------------------------------------------

function handlePlaySet(
  state: GlumGame,
  playerIdx: number,
  playerId: PlayerId,
  glumSet: GlumSet,
): Effect.Effect<GlumGame, InvalidMove> {
  return Effect.gen(function* () {
    const player = state.glumPlayers[playerIdx]!

    // Validate the set itself
    if (!isValidSet(glumSet)) {
      return yield* Effect.fail(new InvalidMove({ message: "Invalid set: cards must all be the same value (jokers are wild)", playerId }))
    }

    // Check pile constraints
    const topSet = state.pile.sets.length > 0 ? state.pile.sets[state.pile.sets.length - 1]! : null

    if (topSet !== null) {
      // Must play same number of cards
      if (glumSet.cards.length !== topSet.cards.length) {
        return yield* Effect.fail(
          new InvalidMove({ message: `Must play ${topSet.cards.length} card(s) to match the pile`, playerId })
        )
      }
      // Must play higher value
      if (setValue(glumSet) <= setValue(topSet)) {
        return yield* Effect.fail(
          new InvalidMove({ message: "Must play a higher value than the top of the pile", playerId })
        )
      }
    }

    // Check player has the cards
    const indices = findCardsInHand(player.deck, glumSet.cards)
    if (indices === null) {
      return yield* Effect.fail(new InvalidMove({ message: "You don't have those cards in your hand", playerId }))
    }

    // Remove cards from hand
    const newHand = removeCardsAtIndices(player.deck, indices)
    const newPlayer: GlumPlayer = { ...player, deck: newHand, passed: false }
    let newPlayers = replacePlayer(state, playerIdx, newPlayer)

    // Add set to pile
    const newPile = { sets: [...state.pile.sets, glumSet] }

    let newOutIndex = state.outIndex

    // If hand is empty, player goes out
    if (newHand.length === 0) {
      newOutIndex = [...state.outIndex, playerIdx]
    }

    let newState: GlumGame = {
      ...state,
      glumPlayers: newPlayers,
      pile: newPile,
      outIndex: newOutIndex,
    }

    // Check if play round should reset (all others passed or out)
    if (shouldResetPlayRound(newState, playerIdx)) {
      newState = resetPlayRound(newState, playerIdx)
    } else {
      newState = { ...newState, currentPlayerIndex: nextActivePlayer(newState, playerIdx) }
    }

    return newState
  })
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

function handlePass(
  state: GlumGame,
  playerIdx: number,
  playerId: PlayerId,
): Effect.Effect<GlumGame, InvalidMove> {
  return Effect.gen(function* () {
    // Can't pass on empty pile
    if (state.pile.sets.length === 0) {
      return yield* Effect.fail(new InvalidMove({ message: "Cannot pass on an empty pile — you must play", playerId }))
    }

    const player = state.glumPlayers[playerIdx]!
    const newPlayer: GlumPlayer = { ...player, passed: true }
    const newPlayers = replacePlayer(state, playerIdx, newPlayer)

    let newState: GlumGame = { ...state, glumPlayers: newPlayers }

    // Check if play round should reset
    // Find the last player who played (the one who put the top set)
    const lastActivePlayer = findLastActivePlayer(newState)
    if (shouldResetPlayRound(newState, lastActivePlayer)) {
      newState = resetPlayRound(newState, lastActivePlayer)
    } else {
      newState = { ...newState, currentPlayerIndex: nextActivePlayer(newState, playerIdx) }
    }

    return newState
  })
}

// ---------------------------------------------------------------------------
// Give (trading) — stubbed for now
// ---------------------------------------------------------------------------

function handleGive(
  state: GlumGame,
  _playerIdx: number,
  playerId: PlayerId,
  _toPlayer: PlayerId,
  _cards: readonly FaceCard[],
): Effect.Effect<GlumGame, InvalidMove> {
  return Effect.fail(new InvalidMove({ message: "Trading is not yet implemented", playerId }))
}

// ---------------------------------------------------------------------------
// Turn helpers
// ---------------------------------------------------------------------------

function replacePlayer(state: GlumGame, index: number, player: GlumPlayer): GlumPlayer[] {
  return state.glumPlayers.map((p, i) => i === index ? player : p)
}

function isPlayerActive(state: GlumGame, idx: number): boolean {
  return !state.glumPlayers[idx]!.passed && !state.outIndex.includes(idx)
}

function nextActivePlayer(state: GlumGame, fromIdx: number): number {
  const n = state.glumPlayers.length
  let next = (fromIdx + 1) % n
  let count = 0
  while (!isPlayerActive(state, next) && count < n) {
    next = (next + 1) % n
    count++
  }
  return next
}

/**
 * Check if only one non-passed, non-out player remains.
 */
function shouldResetPlayRound(state: GlumGame, lastPlayedIdx: number): boolean {
  const n = state.glumPlayers.length
  let activeCount = 0
  for (let i = 0; i < n; i++) {
    if (isPlayerActive(state, i)) activeCount++
  }
  // If only one active player and they're the one who last played, reset
  return activeCount <= 1
}

/**
 * Find the player who played the top set. We track this by finding who is
 * still active (not passed, not out) — after a pass, there should be exactly
 * one such player when we need to reset.
 */
function findLastActivePlayer(state: GlumGame): number {
  const n = state.glumPlayers.length
  for (let i = 0; i < n; i++) {
    if (isPlayerActive(state, i)) return i
  }
  return state.currentPlayerIndex
}

/**
 * Reset the play round: clear pile, reset passed flags, winner leads.
 */
function resetPlayRound(state: GlumGame, leaderIdx: number): GlumGame {
  const newPlayers = state.glumPlayers.map(p => ({ ...p, passed: false }))
  // If the leader is out, find next active player
  let leader = leaderIdx
  if (state.outIndex.includes(leaderIdx)) {
    leader = nextActivePlayer({ ...state, glumPlayers: newPlayers }, leaderIdx)
  }
  return {
    ...state,
    glumPlayers: newPlayers,
    pile: { sets: [] },
    currentPlayerIndex: leader,
  }
}

// ---------------------------------------------------------------------------
// Round / game structure
// ---------------------------------------------------------------------------

export function isRoundOverGlum(state: GlumGame): boolean {
  // Round ends when 2 or fewer players still have cards
  const playersWithCards = state.glumPlayers.filter(p => p.deck.length > 0).length
  return playersWithCards <= Math.min(2, state.glumPlayers.length - 1)
}

function isGameOverGlum(state: GlumGame, config: GameConfig): boolean {
  const totalRounds = (config.options["rounds"] as number | undefined) ?? DEFAULT_ROUNDS
  return state.round >= totalRounds && isRoundOverGlum(state)
}

function nextRoundGlum(state: GlumGame, config: GameConfig): GlumGame {
  const seed = config.options["randomSeed"] as number | undefined
  const numDecks = state.playerIds.length >= 5 ? 2 : 1
  const deck = shuffle(makeDeck(numDecks), seed)

  const numPlayers = state.playerIds.length
  const cardsPerPlayer = Math.floor(deck.length / numPlayers)
  const glumPlayers: GlumPlayer[] = state.playerIds.map((_, i) => ({
    deck: deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer),
    passed: false,
  }))

  // Score the previous round: negative count of remaining cards
  const roundRewards = state.glumPlayers.map(p => -p.deck.length)
  const newRewards = state.rewards.map((r, i) => r + (roundRewards[i] ?? 0))

  return {
    ...state,
    glumPlayers,
    pile: { sets: [] },
    currentPlayerIndex: 0,
    outIndex: [],
    finishedSetup: state.playerIds.map((_, i) => i),
    round: state.round + 1,
    readyPlayers: [],
    rewards: newRewards,
  }
}

// ---------------------------------------------------------------------------
// Scoring helper
// ---------------------------------------------------------------------------

export function glumScore(state: GlumGame): number[] {
  return state.glumPlayers.map(p => -p.deck.length)
}

// ---------------------------------------------------------------------------
// GameFunctions implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stat hooks
// ---------------------------------------------------------------------------

function glumOnRoundEnd(_prevState: GlumGame, newState: GlumGame, _config: GameConfig): StatEntry[] {
  // Skip if solo
  if (newState.playerIds.length <= 1) return []

  const entries: StatEntry[] = []

  // The "king" is the player who went out first (index 0 in outIndex)
  if (newState.outIndex.length > 0) {
    const kingIdx = newState.outIndex[0]!
    const kingId = newState.playerIds[kingIdx]!
    entries.push({
      playerId: kingId,
      gameType: "Glum",
      stat: "glum_king_round",
      value: 1,
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// GameFunctions implementation
// ---------------------------------------------------------------------------

export const glumFunctions: GameFunctions<GlumGame, GlumEvent> = {
  gameType: "Glum",

  initialState: (config, players) =>
    Effect.succeed(initGlum(players, config)),

  next: (state, config, playerId, event) =>
    nextGlum(state, config, playerId, event),

  nextRound: (state, config) =>
    Effect.succeed(nextRoundGlum(state, config)),

  isRoundOver: (state) => isRoundOverGlum(state),

  isGameOver: (state, config) => isGameOverGlum(state, config),

  onRoundEnd: glumOnRoundEnd,
}
