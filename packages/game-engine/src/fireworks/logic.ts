/**
 * Fireworks game logic — Effect-based.
 * Cooperative card game: players work together to build 5 fireworks (one per color) from 1 to 5.
 */

import { Effect } from "effect"
import type {
  FireworksEvent,
  FireworksGame,
  FireworksPlayer,
  FireworksCard,
  FireworkColor,
  FireworksDeck,
  GameConfig,
  Player,
  PlayerId,
} from "@games/effect-schemas"
import { InvalidMove, NotYourTurn, initGenericFields } from "@games/effect-schemas"
import type { GameFunctions } from "../engine.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_COLORS: FireworkColor[] = ["red", "green", "blue", "white", "yellow"]

// ---------------------------------------------------------------------------
// Seeded RNG (same mulberry32 as flylo/deck.ts)
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
// Deck construction
// ---------------------------------------------------------------------------

function makeFireworksDeck(seed?: number): FireworksDeck {
  const cards: FireworksCard[] = []
  for (const color of ALL_COLORS) {
    // three 1s, two 2s, two 3s, two 4s, one 5
    for (let i = 0; i < 3; i++) cards.push({ color, number: 1 })
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i < 2; i++) cards.push({ color, number: n })
    }
    cards.push({ color, number: 5 })
  }
  return { cards: shuffle(cards, seed) }
}

function handSize(playerCount: number): number {
  if (playerCount <= 3) return 5
  if (playerCount <= 5) return 4
  return 3
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlayerIndex(state: FireworksGame, playerId: PlayerId): number {
  return state.playerIds.indexOf(playerId)
}

function removeCardFromHand(player: FireworksPlayer, card: FireworksCard): { player: FireworksPlayer; found: boolean } {
  const idx = player.cards.findIndex(c => c.color === card.color && c.number === card.number)
  if (idx === -1) return { player, found: false }
  const newCards = [...player.cards]
  newCards.splice(idx, 1)
  return { player: { cards: newCards }, found: true }
}

function drawCard(drawPile: FireworksDeck): { card: FireworksCard | null; drawPile: FireworksDeck } {
  if (drawPile.cards.length === 0) return { card: null, drawPile }
  const [first, ...rest] = drawPile.cards
  return { card: first!, drawPile: { cards: rest } }
}

function replacePlayer(state: FireworksGame, index: number, player: FireworksPlayer): FireworksPlayer[] {
  return state.fireworksPlayers.map((p, i) => i === index ? player : p)
}

function advanceTurn(state: FireworksGame): FireworksGame {
  const nextIdx = (state.currentPlayerIndex + 1) % state.playerIds.length
  return { ...state, currentPlayerIndex: nextIdx }
}

export function fireworksScore(state: FireworksGame): number {
  return ALL_COLORS.reduce((sum, c) => sum + (state.fireworks[c] ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handlePlay(
  state: FireworksGame,
  playerIdx: number,
  playerId: PlayerId,
  card: FireworksCard,
): Effect.Effect<FireworksGame, InvalidMove> {
  return Effect.gen(function* () {
    const player = state.fireworksPlayers[playerIdx]!
    const { player: updatedPlayer, found } = removeCardFromHand(player, card)
    if (!found) {
      return yield* Effect.fail(new InvalidMove({ message: "Card not in hand", playerId }))
    }

    let newState = { ...state }
    const currentValue = state.fireworks[card.color] ?? 0

    if (card.number === currentValue + 1) {
      // Success: increment firework
      const newFireworks = { ...state.fireworks, [card.color]: currentValue + 1 }
      newState = { ...newState, fireworks: newFireworks }
      // Completing a firework (reaching 5) earns a clock
      if (currentValue + 1 === 5 && newState.numClocks < 8) {
        newState = { ...newState, numClocks: newState.numClocks + 1 }
      }
    } else {
      // Failure: lose a fuse, discard the card
      newState = {
        ...newState,
        numFuses: newState.numFuses - 1,
        discardPile: { cards: [...newState.discardPile.cards, card] },
      }
    }

    // Draw replacement card
    const { card: drawn, drawPile: newDrawPile } = drawCard(newState.drawPile)
    let finalPlayer = updatedPlayer
    if (drawn) {
      finalPlayer = { cards: [...updatedPlayer.cards, drawn] }
    }
    newState = {
      ...newState,
      drawPile: newDrawPile,
      fireworksPlayers: replacePlayer(newState, playerIdx, finalPlayer),
    }

    // Check if draw pile just became empty — start final countdown
    if (newState.drawPile.cards.length === 0 && state.drawPile.cards.length > 0 && newState.playerOut === null) {
      const nextIdx = (playerIdx + 1) % newState.playerIds.length
      newState = { ...newState, playerOut: nextIdx }
    }

    // Advance turn
    newState = advanceTurn(newState)
    return newState
  })
}

function handleDiscard(
  state: FireworksGame,
  playerIdx: number,
  playerId: PlayerId,
  card: FireworksCard,
): Effect.Effect<FireworksGame, InvalidMove> {
  return Effect.gen(function* () {
    const player = state.fireworksPlayers[playerIdx]!
    const { player: updatedPlayer, found } = removeCardFromHand(player, card)
    if (!found) {
      return yield* Effect.fail(new InvalidMove({ message: "Card not in hand", playerId }))
    }

    let newState = {
      ...state,
      discardPile: { cards: [...state.discardPile.cards, card] },
      numClocks: Math.min(state.numClocks + 1, 8),
    }

    // Draw replacement card
    const { card: drawn, drawPile: newDrawPile } = drawCard(newState.drawPile)
    let finalPlayer = updatedPlayer
    if (drawn) {
      finalPlayer = { cards: [...updatedPlayer.cards, drawn] }
    }
    newState = {
      ...newState,
      drawPile: newDrawPile,
      fireworksPlayers: replacePlayer(newState, playerIdx, finalPlayer),
    }

    // Check if draw pile just became empty
    if (newState.drawPile.cards.length === 0 && state.drawPile.cards.length > 0 && newState.playerOut === null) {
      const nextIdx = (playerIdx + 1) % newState.playerIds.length
      newState = { ...newState, playerOut: nextIdx }
    }

    // Advance turn
    newState = advanceTurn(newState)
    return newState
  })
}

function handleInfoColor(
  state: FireworksGame,
  playerIdx: number,
  playerId: PlayerId,
  color: FireworkColor,
  hintFor: PlayerId,
): Effect.Effect<FireworksGame, InvalidMove> {
  return Effect.gen(function* () {
    if (state.numClocks <= 0) {
      return yield* Effect.fail(new InvalidMove({ message: "No clocks remaining to give a hint", playerId }))
    }
    if (hintFor === playerId) {
      return yield* Effect.fail(new InvalidMove({ message: "Cannot hint yourself", playerId }))
    }
    const hintPlayerIdx = getPlayerIndex(state, hintFor)
    if (hintPlayerIdx === -1) {
      return yield* Effect.fail(new InvalidMove({ message: "Hint target player not found", playerId }))
    }

    const nextIdx = (playerIdx + 1) % state.playerIds.length
    return {
      ...state,
      numClocks: state.numClocks - 1,
      showColor: color,
      showNumber: null,
      hintForPlayer: hintFor,
      nextPlayerIndex: nextIdx,
      currentPlayerIndex: -1, // waiting for acknowledgment
    }
  })
}

function handleInfoNumber(
  state: FireworksGame,
  playerIdx: number,
  playerId: PlayerId,
  number: number,
  hintFor: PlayerId,
): Effect.Effect<FireworksGame, InvalidMove> {
  return Effect.gen(function* () {
    if (state.numClocks <= 0) {
      return yield* Effect.fail(new InvalidMove({ message: "No clocks remaining to give a hint", playerId }))
    }
    if (hintFor === playerId) {
      return yield* Effect.fail(new InvalidMove({ message: "Cannot hint yourself", playerId }))
    }
    const hintPlayerIdx = getPlayerIndex(state, hintFor)
    if (hintPlayerIdx === -1) {
      return yield* Effect.fail(new InvalidMove({ message: "Hint target player not found", playerId }))
    }

    const nextIdx = (playerIdx + 1) % state.playerIds.length
    return {
      ...state,
      numClocks: state.numClocks - 1,
      showColor: null,
      showNumber: number,
      hintForPlayer: hintFor,
      nextPlayerIndex: nextIdx,
      currentPlayerIndex: -1, // waiting for acknowledgment
    }
  })
}

function handleSawHint(
  state: FireworksGame,
  playerId: PlayerId,
): Effect.Effect<FireworksGame, InvalidMove> {
  return Effect.gen(function* () {
    if (state.hintForPlayer !== playerId) {
      return yield* Effect.fail(new InvalidMove({ message: "No hint pending for this player", playerId }))
    }

    return {
      ...state,
      showColor: null,
      showNumber: null,
      hintForPlayer: null,
      currentPlayerIndex: state.nextPlayerIndex!,
      nextPlayerIndex: null,
    }
  })
}

// ---------------------------------------------------------------------------
// Main next function
// ---------------------------------------------------------------------------

function nextFireworks(
  state: FireworksGame,
  _config: GameConfig,
  playerId: PlayerId,
  event: FireworksEvent,
): Effect.Effect<FireworksGame, InvalidMove | NotYourTurn> {
  return Effect.gen(function* () {
    if (isRoundOverFireworks(state)) {
      return yield* Effect.fail(new InvalidMove({ message: "Game is over", playerId }))
    }

    const playerIdx = getPlayerIndex(state, playerId)
    if (playerIdx === -1) {
      return yield* Effect.fail(new InvalidMove({ message: "Player not found", playerId }))
    }

    // fw_sawHint: only the hintForPlayer can act
    if (event.kind === "fw_sawHint") {
      return yield* handleSawHint(state, playerId)
    }

    // For all other events, must be current player's turn
    if (state.hintForPlayer !== null) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Waiting for hint acknowledgment", playerId })
      )
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
      case "fw_play":
        return yield* handlePlay(state, playerIdx, playerId, event.card)
      case "fw_discard":
        return yield* handleDiscard(state, playerIdx, playerId, event.card)
      case "fw_infoColor":
        return yield* handleInfoColor(state, playerIdx, playerId, event.color, event.hintFor)
      case "fw_infoNumber":
        return yield* handleInfoNumber(state, playerIdx, playerId, event.number, event.hintFor)
    }
  })
}

// ---------------------------------------------------------------------------
// Terminal conditions
// ---------------------------------------------------------------------------

export function isRoundOverFireworks(state: FireworksGame): boolean {
  if (state.numFuses === 0) return true
  if (state.playerOut !== null && state.currentPlayerIndex === state.playerOut) return true
  return false
}

// ---------------------------------------------------------------------------
// GameFunctions implementation
// ---------------------------------------------------------------------------

export const fireworksFunctions: GameFunctions<FireworksGame, FireworksEvent> = {
  gameType: "Fireworks",

  initialState: (config, players) =>
    Effect.gen(function* () {
      if (players.length < 2 || players.length > 6) {
        return yield* Effect.fail(
          new InvalidMove({ message: `Fireworks requires 2-6 players, got ${players.length}`, playerId: "" as PlayerId })
        )
      }
      const seed = config.options["randomSeed"] as number | undefined
      const deck = makeFireworksDeck(seed)
      const hs = handSize(players.length)

      const fireworksPlayers: FireworksPlayer[] = []
      let drawIdx = 0
      for (const _ of players) {
        fireworksPlayers.push({ cards: deck.cards.slice(drawIdx, drawIdx + hs) })
        drawIdx += hs
      }

      const fireworks = Object.fromEntries(ALL_COLORS.map(c => [c, 0])) as Record<FireworkColor, number>

      return {
        ...initGenericFields(players),
        type: "Fireworks" as const,
        playerIds: players.map(p => p.id),
        fireworksPlayers,
        fireworks,
        drawPile: { cards: deck.cards.slice(drawIdx) },
        discardPile: { cards: [] },
        currentPlayerIndex: 0,
        nextPlayerIndex: null,
        playerOut: null,
        hintForPlayer: null,
        showColor: null,
        showNumber: null,
        numClocks: 8,
        numFuses: 3,
      }
    }),

  next: (state, config, playerId, event) =>
    nextFireworks(state, config, playerId, event),

  nextRound: (state, _config) =>
    Effect.succeed(state), // single round game

  isRoundOver: (state) => isRoundOverFireworks(state),

  isGameOver: (state) => isRoundOverFireworks(state),
}
