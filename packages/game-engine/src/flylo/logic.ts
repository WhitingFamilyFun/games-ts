/**
 * Flylo game logic — Effect-based port.
 * Returns Effect<FlyloGame, InvalidMove | NotYourTurn> instead of MaybeError<FlyloGame>.
 */

import { Effect } from "effect"
import type {
  FlyloEvent,
  FlyloGame,
  FlyloPlayer,
  GameCard,
  GameConfig,
  Player,
  PlayerId,
} from "@games/effect-schemas"
import { InvalidMove, NotYourTurn, initGenericFields } from "@games/effect-schemas"
import type { GameFunctions } from "../engine.js"
import {
  addCard,
  allCards,
  deckVisibleTotal,
  drawFromDeck,
  drawFromEnd,
  emptyDeck,
  flipAllCards,
  flipCard,
  hasThreesome,
  replaceCard,
  shuffleDeck,
  threesomeStartIndex,
} from "./deck.js"

// Win threshold: game ends when any player reaches this score
const DEFAULT_WIN_THRESHOLD = 100

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initFlylo(
  players: readonly Player[],
  config: GameConfig,
): FlyloGame {
  const seed = config.options["randomSeed"] as number | undefined
  const shuffled = shuffleDeck(allCards(), seed)

  const flyloPlayers: FlyloPlayer[] = players.map(() => ({
    deck: emptyDeck,
    currentScore: 0,
    discardToFlip: false,
    fromDiscard: false,
    card: null,
  }))

  // Deal 12 cards to each player face-down
  let drawPile = shuffled
  const dealt = [...flyloPlayers]
  for (let cardI = 0; cardI < 12; cardI++) {
    for (let p = 0; p < players.length; p++) {
      const { card, deck } = drawFromDeck(drawPile)
      drawPile = deck
      const faceDownCard: GameCard = { ...card, flipped: false }
      dealt[p] = { ...dealt[p]!, deck: addCard(dealt[p]!.deck, faceDownCard) }
    }
  }

  // Put one card face-up on discard
  const { card: topCard, deck: finalDraw } = drawFromDeck(drawPile)

  return {
    ...initGenericFields(players),
    type: "Flylo",
    playerIds: players.map(player => player.id),
    flyloPlayers: dealt,
    discardPile: addCard(emptyDeck, { ...topCard, flipped: true }),
    drawPile: finalDraw,
    currentPlayerIndex: 0,
    firstPlayerOutIndex: null,
    debug: false,
  }
}

// ---------------------------------------------------------------------------
// Turn logic
// ---------------------------------------------------------------------------

function nextFlylo(
  state: FlyloGame,
  _config: GameConfig,
  playerId: PlayerId,
  event: FlyloEvent,
): Effect.Effect<FlyloGame, InvalidMove | NotYourTurn> {
  return Effect.gen(function* () {
    const playerIdx = getPlayerIndex(state, playerId)
    if (playerIdx === -1) {
      return yield* Effect.fail(new InvalidMove({ message: "Player not found", playerId }))
    }

    const inSetup = !isReadyToStart(state)
    const setupFlipAllowed = inSetup && event.kind === "flip"
    if (!setupFlipAllowed && state.currentPlayerIndex !== playerIdx) {
      return yield* Effect.fail(
        new NotYourTurn({
          playerId,
          currentPlayerId: state.playerIds[state.currentPlayerIndex]!,
        })
      )
    }

    const player = state.flyloPlayers[playerIdx]!

    switch (event.kind) {
      case "draw":
        return yield* handleDraw(state, playerIdx, player, playerId, event.fromDiscard)
      case "flip":
        return yield* handleFlip(state, playerIdx, player, playerId, event.index)
      case "discard":
        return yield* handleDiscard(state, playerIdx, player, playerId)
      case "replace":
        return yield* handleReplace(state, playerIdx, player, playerId, event.index)
    }
  })
}

function getPlayerIndex(state: FlyloGame, playerId: string): number {
  return state.playerIds.indexOf(playerId as PlayerId)
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

function handleDraw(
  state: FlyloGame,
  playerIdx: number,
  player: FlyloPlayer,
  playerId: PlayerId,
  fromDiscard: boolean,
): Effect.Effect<FlyloGame, InvalidMove> {
  return Effect.gen(function* () {
    if (!isReadyToStart(state) && !anyPlayerInSetup(state)) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Players need to flip their starting cards before taking round actions", playerId })
      )
    }
    if (player.card !== null || player.discardToFlip) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Players must finish their turn before drawing again", playerId })
      )
    }

    if (fromDiscard) {
      if (state.discardPile.cards.length === 0) {
        return yield* Effect.fail(new InvalidMove({ message: "Discard pile is empty", playerId }))
      }
      const { card, deck: newDiscard } = drawFromEnd(state.discardPile)
      const newPlayer: FlyloPlayer = { ...player, card, fromDiscard: true }
      return { ...state, discardPile: newDiscard, flyloPlayers: replacePlayer(state, playerIdx, newPlayer) }
    } else {
      if (state.drawPile.cards.length === 0) {
        return yield* Effect.fail(new InvalidMove({ message: "Draw pile is empty", playerId }))
      }
      const { card, deck: newDraw } = drawFromDeck(state.drawPile)
      const newPlayer: FlyloPlayer = { ...player, card: { ...card, flipped: true }, fromDiscard: false }
      return { ...state, drawPile: newDraw, flyloPlayers: replacePlayer(state, playerIdx, newPlayer) }
    }
  })
}

// ---------------------------------------------------------------------------
// Flip
// ---------------------------------------------------------------------------

function handleFlip(
  state: FlyloGame,
  playerIdx: number,
  player: FlyloPlayer,
  playerId: PlayerId,
  index: number,
): Effect.Effect<FlyloGame, InvalidMove> {
  return Effect.gen(function* () {
    const card = player.deck.cards[index]
    if (!card) {
      return yield* Effect.fail(new InvalidMove({ message: "Card index out of range", playerId }))
    }
    if (card.flipped) {
      return yield* Effect.fail(new InvalidMove({ message: "That card was already flipped", playerId }))
    }
    if (isReadyToStart(state) && !player.discardToFlip && player.card === null) {
      if (!player.discardToFlip) {
        return yield* Effect.fail(
          new InvalidMove({ message: "Already flipped all starting cards — draw a card first", playerId })
        )
      }
    }

    const newDeck = flipCard(player.deck, index)
    const newPlayer: FlyloPlayer = { ...player, deck: newDeck, discardToFlip: false }
    const newPlayers = replacePlayer(state, playerIdx, newPlayer)
    let next: FlyloGame = { ...state, flyloPlayers: newPlayers }

    // If flipping during discardToFlip mode, complete the move
    if (player.discardToFlip) {
      next = finishMove(next, playerIdx, next.flyloPlayers, next.discardPile)
      return next
    }

    // During setup: check if all players are now ready to start
    if (!isReadyToStart(state) && allPlayersReadyToStart(next)) {
      const startingPlayer = playerToStart(next)
      next = { ...next, currentPlayerIndex: startingPlayer, firstPlayerOutIndex: null }
    }

    return next
  })
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

function handleDiscard(
  state: FlyloGame,
  playerIdx: number,
  player: FlyloPlayer,
  playerId: PlayerId,
): Effect.Effect<FlyloGame, InvalidMove> {
  return Effect.gen(function* () {
    if (player.card === null) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Player can't discard a card until they have drawn one", playerId })
      )
    }
    if (!isReadyToStart(state)) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Players need to flip their starting cards before taking round actions", playerId })
      )
    }
    if (player.fromDiscard) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Player cannot discard a card drawn from the discard pile", playerId })
      )
    }

    const newDiscard = addCard(state.discardPile, player.card)
    const newPlayer: FlyloPlayer = { ...player, card: null, discardToFlip: true }
    return { ...state, discardPile: newDiscard, flyloPlayers: replacePlayer(state, playerIdx, newPlayer) }
  })
}

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

function handleReplace(
  state: FlyloGame,
  playerIdx: number,
  player: FlyloPlayer,
  playerId: PlayerId,
  index: number,
): Effect.Effect<FlyloGame, InvalidMove> {
  return Effect.gen(function* () {
    if (player.card === null) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Player can't replace a card until they have drawn one", playerId })
      )
    }
    if (!isReadyToStart(state)) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Players need to flip their starting cards before taking round actions", playerId })
      )
    }
    if (index < 0 || index >= player.deck.cards.length) {
      return yield* Effect.fail(new InvalidMove({ message: "Card index out of range", playerId }))
    }

    const replaced = player.deck.cards[index]!
    const newDeck = replaceCard(player.deck, index, { ...player.card, flipped: true })
    const newPlayer: FlyloPlayer = { ...player, deck: newDeck, card: null }
    const newDiscard = addCard(state.discardPile, { ...replaced, flipped: true })
    const newPlayers = replacePlayer(state, playerIdx, newPlayer)
    const next = finishMove(
      { ...state, flyloPlayers: newPlayers, discardPile: newDiscard },
      playerIdx,
      newPlayers,
      newDiscard,
    )
    return next
  })
}

// ---------------------------------------------------------------------------
// Round / game structure
// ---------------------------------------------------------------------------

function nextRoundFlylo(state: FlyloGame, config: GameConfig): FlyloGame {
  const seed = config.options["randomSeed"] as number | undefined
  const shuffled = shuffleDeck(allCards(), seed)
  const emptyPlayers = state.flyloPlayers.map(p => ({
    ...p,
    deck: emptyDeck,
    card: null,
    discardToFlip: false,
    fromDiscard: false,
  }))

  let drawPile = shuffled
  const dealt = [...emptyPlayers]
  for (let cardI = 0; cardI < 12; cardI++) {
    for (let p = 0; p < dealt.length; p++) {
      const { card, deck } = drawFromDeck(drawPile)
      drawPile = deck
      dealt[p] = { ...dealt[p]!, deck: addCard(dealt[p]!.deck, { ...card, flipped: false }) }
    }
  }
  const { card: topCard, deck: finalDraw } = drawFromDeck(drawPile)

  const startIndex = state.firstPlayerOutIndex ?? 0
  return {
    ...state,
    flyloPlayers: dealt,
    discardPile: addCard(emptyDeck, { ...topCard, flipped: true }),
    drawPile: finalDraw,
    currentPlayerIndex: startIndex,
    firstPlayerOutIndex: null,
  }
}

export function isGameOverFlylo(state: FlyloGame, config: GameConfig): boolean {
  const threshold = (config.options["winThreshold"] as number | undefined) ?? DEFAULT_WIN_THRESHOLD
  return state.flyloPlayers.some(p => p.currentScore >= threshold)
}

export function isRoundOverFlylo(state: FlyloGame): boolean {
  return state.firstPlayerOutIndex !== null && state.flyloPlayers.every(isEndCondition)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isReadyToStart(state: FlyloGame): boolean {
  return state.flyloPlayers.every(playerReadyToStart)
}

function playerReadyToStart(p: FlyloPlayer): boolean {
  const flipped = p.deck.cards.filter(c => c.flipped).length
  return (flipped >= 2 && p.deck.cards.length === 12) || p.deck.cards.length < 12
}

function anyPlayerInSetup(state: FlyloGame): boolean {
  return state.flyloPlayers.some(p => !playerReadyToStart(p))
}

function allPlayersReadyToStart(state: FlyloGame): boolean {
  return state.flyloPlayers.every(playerReadyToStart)
}

function playerToStart(state: FlyloGame): number {
  let min = Infinity
  let minIdx = 0
  state.flyloPlayers.forEach((p, i) => {
    const total = deckVisibleTotal(p.deck)
    if (total < min) { min = total; minIdx = i }
  })
  return minIdx
}

function replacePlayer(state: FlyloGame, index: number, player: FlyloPlayer): FlyloPlayer[] {
  return state.flyloPlayers.map((p, i) => i === index ? player : p)
}

function isEndCondition(p: FlyloPlayer): boolean {
  return p.deck.cards.length > 0 && p.deck.cards.every(c => c.flipped)
}

/**
 * Called after a replace or flip-after-discard completes a full move.
 * Handles threesome removal, end condition, and round-over scoring.
 */
function finishMove(
  state: FlyloGame,
  playerIdx: number,
  players: FlyloPlayer[],
  discardPile: FlyloGame["discardPile"],
): FlyloGame {
  let game: FlyloGame = { ...state, flyloPlayers: players, discardPile }

  // Remove threesomes
  game = checkForThree(game)
  game = checkForNeedShuffle(game)

  const currentPlayer = game.flyloPlayers[playerIdx]!

  if (isEndCondition(currentPlayer) && game.firstPlayerOutIndex === null) {
    const next = { ...game, firstPlayerOutIndex: playerIdx }
    const nextPlayerIdx = (playerIdx + 1) % next.flyloPlayers.length
    if (isRoundDone(next)) {
      return scoreRound(flipAllForRound(next))
    }
    return { ...next, currentPlayerIndex: nextPlayerIdx }
  }

  if (isRoundDone(game)) {
    return scoreRound(flipAllForRound(game))
  }

  return { ...game, currentPlayerIndex: (playerIdx + 1) % game.flyloPlayers.length }
}

function isRoundDone(state: FlyloGame): boolean {
  if (state.firstPlayerOutIndex === null) return false
  return state.currentPlayerIndex === state.firstPlayerOutIndex
    ? state.flyloPlayers.every(isEndCondition)
    : false
}

function flipAllForRound(state: FlyloGame): FlyloGame {
  return {
    ...state,
    flyloPlayers: state.flyloPlayers.map(p => ({
      ...p,
      deck: flipAllCards(p.deck),
    })),
  }
}

function scoreRound(state: FlyloGame): FlyloGame {
  const fpoIdx = state.firstPlayerOutIndex!
  const fpo = state.flyloPlayers[fpoIdx]!
  const fpoVisible = deckVisibleTotal(fpo.deck)
  const lowestScore = Math.min(...state.flyloPlayers.map(p => deckVisibleTotal(p.deck)))
  const fpoIsLowest = fpoVisible <= lowestScore

  const newPlayers = state.flyloPlayers.map((p, i) => {
    const visible = deckVisibleTotal(p.deck)
    if (i === fpoIdx && !fpoIsLowest && visible > 0) {
      return { ...p, currentScore: p.currentScore + visible * 2 }
    }
    return { ...p, currentScore: p.currentScore + visible }
  })

  return { ...state, flyloPlayers: newPlayers }
}

function checkForThree(state: FlyloGame): FlyloGame {
  let changed = true
  let game = state
  while (changed) {
    changed = false
    for (let p = 0; p < game.flyloPlayers.length; p++) {
      const player = game.flyloPlayers[p]!
      if (hasThreesome(player.deck)) {
        const start = threesomeStartIndex(player.deck)
        const cards = [...player.deck.cards]
        const removed = cards.splice(start, 3)
        const newDiscard = removed.reduce((d, c) => addCard(d, { ...c, flipped: true }), game.discardPile)
        const newPlayer = { ...player, deck: { cards } }
        game = { ...game, flyloPlayers: replacePlayer(game, p, newPlayer), discardPile: newDiscard }
        changed = true
      }
    }
  }
  return game
}

function checkForNeedShuffle(state: FlyloGame): FlyloGame {
  if (state.drawPile.cards.length === 0 && state.discardPile.cards.length > 1) {
    const topOfDiscard = state.discardPile.cards[state.discardPile.cards.length - 1]!
    const toShuffle = { cards: state.discardPile.cards.slice(0, -1) }
    const reshuffled = shuffleDeck(toShuffle)
    return {
      ...state,
      drawPile: reshuffled,
      discardPile: { cards: [topOfDiscard] },
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// GameFunctions implementation
// ---------------------------------------------------------------------------

export const flyloFunctions: GameFunctions<FlyloGame, FlyloEvent> = {
  gameType: "Flylo",

  initialState: (config, players) =>
    Effect.succeed(initFlylo(players, config)),

  next: (state, config, playerId, event) =>
    nextFlylo(state, config, playerId, event),

  nextRound: (state, config) =>
    Effect.succeed(nextRoundFlylo(state, config)),

  isRoundOver: (state) => isRoundOverFlylo(state),

  isGameOver: (state, config) => isGameOverFlylo(state, config),
}
