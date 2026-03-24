/**
 * Flixx game logic -- Effect-based port.
 * Returns Effect<FlixxGame, InvalidMove | NotYourTurn> instead of MaybeError<FlixxGame>.
 */

import { Effect } from "effect"
import type {
  CurrentPlayerChoice,
  DiceRoll,
  FlixxCard,
  FlixxColor,
  FlixxEvent,
  FlixxGame,
  FlixxPlayer,
  FlixxRoll,
  FlixxRow,
  GameConfig,
  Player,
  PlayerId,
  StatEntry,
} from "@games/effect-schemas"
import { InvalidMove, NotYourTurn, initGenericFields } from "@games/effect-schemas"
import type { GameFunctions } from "../engine.js"

// ---------------------------------------------------------------------------
// Scoring table (Qwixx style)
// ---------------------------------------------------------------------------
export const FLIXX_SCORE_MAP: Record<number, number> = {
  0: 0, 1: 1, 2: 3, 3: 6, 4: 10, 5: 15,
  6: 21, 7: 28, 8: 36, 9: 45, 10: 55, 11: 66, 12: 78,
}

export const ALL_FLIXX_COLORS: FlixxColor[] = ["red", "yellow", "green", "blue", "purple"]

// Red/Yellow go low-to-high (2-12); Green/Blue/Purple go high-to-low (12-2)
export const LOW_TO_HIGH: Record<FlixxColor, boolean> = {
  red: true,
  yellow: true,
  green: false,
  blue: false,
  purple: false,
}

// ---------------------------------------------------------------------------
// FlixxRow helpers
// ---------------------------------------------------------------------------

function newRow(color: FlixxColor): FlixxRow {
  return { color, row: Array(11).fill(false) as boolean[], locked: false, didLock: false }
}

function rowCurrentPoints(row: FlixxRow): number {
  const count = row.row.filter(Boolean).length + (row.didLock ? 1 : 0)
  return FLIXX_SCORE_MAP[count] ?? 0
}

function rowLastSelected(row: FlixxRow): number {
  const lth = LOW_TO_HIGH[row.color]
  if (lth) {
    const idx = row.row.lastIndexOf(true)
    return idx === -1 ? -1 : idx
  } else {
    const idx = row.row.indexOf(true)
    return idx === -1 ? 11 : idx
  }
}

/** index is 0-based: 0 = number 2, 10 = number 12 */
function canMoveRow(row: FlixxRow, index: number): boolean {
  if (row.locked) return false
  const last = rowLastSelected(row)
  if (LOW_TO_HIGH[row.color]) {
    return index > last
  } else {
    return index < last
  }
}

function moveRow(row: FlixxRow, index: number, playerId: string): Effect.Effect<FlixxRow, InvalidMove> {
  return Effect.gen(function* () {
    if (!canMoveRow(row, index)) {
      return yield* Effect.fail(
        new InvalidMove({ message: `Cannot move to index ${index} on ${row.color}`, playerId })
      )
    }
    const newRowArr = [...row.row]
    newRowArr[index] = true
    return { ...row, row: newRowArr }
  })
}

function lockRow(row: FlixxRow): FlixxRow {
  return { ...row, locked: true, didLock: true }
}

function rowUnavailable(row: FlixxRow, index: number): boolean {
  return !canMoveRow(row, index) || row.row[index] === true
}

function rowCanLock(row: FlixxRow): boolean {
  return row.row.filter(Boolean).length >= 5
}

// ---------------------------------------------------------------------------
// FlixxCard helpers
// ---------------------------------------------------------------------------

export function newCard(): FlixxCard {
  const rows = Object.fromEntries(
    ALL_FLIXX_COLORS.map(c => [c, newRow(c)])
  ) as Record<FlixxColor, FlixxRow>
  return { rows, numPenalties: 0 }
}

function cardCurrentScore(card: FlixxCard): number {
  const rowPoints = ALL_FLIXX_COLORS.reduce((sum, c) => sum + rowCurrentPoints(card.rows[c]!), 0)
  return rowPoints - card.numPenalties * 5
}

function cardCanMove(card: FlixxCard, color: FlixxColor, index: number): boolean {
  return canMoveRow(card.rows[color]!, index)
}

function cardMove(card: FlixxCard, color: FlixxColor, index: number, playerId: string): Effect.Effect<FlixxCard, InvalidMove> {
  return Effect.gen(function* () {
    const newRow = yield* moveRow(card.rows[color]!, index, playerId)
    return { ...card, rows: { ...card.rows, [color]: newRow } }
  })
}

function cardLocked(card: FlixxCard, color: FlixxColor): boolean {
  return card.rows[color]!.locked
}

function cardLock(card: FlixxCard, color: FlixxColor): FlixxCard {
  return { ...card, rows: { ...card.rows, [color]: lockRow(card.rows[color]!) } }
}

function cardTakePenalty(card: FlixxCard): FlixxCard {
  return { ...card, numPenalties: card.numPenalties + 1 }
}

function cardUnavailable(card: FlixxCard, color: FlixxColor, index: number): boolean {
  return rowUnavailable(card.rows[color]!, index)
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

function rollDie(): DiceRoll {
  return { value: Math.floor(Math.random() * 6) + 1 }
}

export function rollFlixx(): FlixxRoll {
  return {
    white1: rollDie(),
    white2: rollDie(),
    coloredRolls: Object.fromEntries(ALL_FLIXX_COLORS.map(c => [c, rollDie()])) as Record<FlixxColor, DiceRoll>,
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initFlixx(
  players: readonly Player[],
  _config: GameConfig,
): FlixxGame {
  const flixxPlayers = Object.fromEntries(
    players.map(p => [p.id, { card: newCard() } as FlixxPlayer])
  ) as Record<PlayerId, FlixxPlayer>
  return {
    ...initGenericFields(players),
    type: "Flixx",
    flixxPlayers,
    playersSubmittedForRound: [],
    currentRoll: rollFlixx(),
    currentChoice: { kind: "none" },
    rolled: false,
    currentPlayerIndex: Math.floor(Math.random() * players.length),
  }
}

// ---------------------------------------------------------------------------
// Turn logic
// ---------------------------------------------------------------------------

function nextFlixx(
  state: FlixxGame,
  _config: GameConfig,
  playerId: PlayerId,
  event: FlixxEvent,
): Effect.Effect<FlixxGame, InvalidMove | NotYourTurn> {
  return Effect.gen(function* () {
    // Block all moves when the round/game is over
    if (isRoundOverFlixx(state)) {
      return yield* Effect.fail(new InvalidMove({ message: "Game is over", playerId }))
    }

    const playerIds = Object.keys(state.flixxPlayers)
    const playerIdx = playerIds.indexOf(playerId)
    if (playerIdx === -1) {
      return yield* Effect.fail(new InvalidMove({ message: "Player not found", playerId }))
    }
    const isCurrentPlayer = playerIdx === state.currentPlayerIndex

    switch (event.kind) {
      case "roll":
        return yield* handleRoll(state, playerId, isCurrentPlayer)
      case "pass":
        return yield* handlePass(state, playerId)
      case "takePenalty":
        return yield* handleTakePenalty(state, playerId)
      case "takeRoll":
        return yield* handleTakeRoll(state, playerId, event.color, event.index, isCurrentPlayer)
    }
  })
}

// ---------------------------------------------------------------------------
// Roll
// ---------------------------------------------------------------------------

function handleRoll(
  state: FlixxGame,
  playerId: string,
  isCurrentPlayer: boolean,
): Effect.Effect<FlixxGame, InvalidMove | NotYourTurn> {
  return Effect.gen(function* () {
    if (!isCurrentPlayer) {
      const playerIds = Object.keys(state.flixxPlayers)
      return yield* Effect.fail(
        new NotYourTurn({
          playerId,
          currentPlayerId: playerIds[state.currentPlayerIndex]!,
        })
      )
    }
    if (state.rolled) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Already rolled this turn", playerId })
      )
    }
    return { ...state, currentRoll: rollFlixx(), rolled: true }
  })
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

function handlePass(
  state: FlixxGame,
  playerId: string,
): Effect.Effect<FlixxGame, InvalidMove> {
  return Effect.gen(function* () {
    if (state.playersSubmittedForRound.includes(playerId as PlayerId)) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Already passed this round", playerId })
      )
    }
    const submitted = [...state.playersSubmittedForRound, playerId as PlayerId]
    const next: FlixxGame = { ...state, playersSubmittedForRound: submitted }
    if (isReadyForNextRound(next)) {
      return advanceRound(next)
    }
    return next
  })
}

// ---------------------------------------------------------------------------
// Take Penalty
// ---------------------------------------------------------------------------

function handleTakePenalty(
  state: FlixxGame,
  playerId: string,
): Effect.Effect<FlixxGame, InvalidMove> {
  return Effect.gen(function* () {
    const player = state.flixxPlayers[playerId as PlayerId]
    if (!player) {
      return yield* Effect.fail(new InvalidMove({ message: "Player not found", playerId }))
    }
    const updatedCard = cardTakePenalty(player.card)
    return {
      ...state,
      flixxPlayers: { ...state.flixxPlayers, [playerId]: { card: updatedCard } },
      currentChoice: { kind: "none" } as CurrentPlayerChoice,
    }
  })
}

// ---------------------------------------------------------------------------
// Take Roll
// ---------------------------------------------------------------------------

function handleTakeRoll(
  state: FlixxGame,
  playerId: string,
  color: FlixxColor,
  index: number,
  isCurrentPlayer: boolean,
): Effect.Effect<FlixxGame, InvalidMove> {
  return Effect.gen(function* () {
    const player = state.flixxPlayers[playerId as PlayerId]
    if (!player) {
      return yield* Effect.fail(new InvalidMove({ message: "Player not found", playerId }))
    }
    if (!state.rolled) {
      return yield* Effect.fail(
        new InvalidMove({ message: "Must roll before making a choice", playerId })
      )
    }

    // index is the actual number (2-12); convert to 0-based
    const rowIndex = LOW_TO_HIGH[color] ? index - 2 : 12 - index

    if (cardUnavailable(player.card, color, rowIndex)) {
      return yield* Effect.fail(
        new InvalidMove({ message: `Cannot take ${color} at ${index}`, playerId })
      )
    }

    // Validate against the dice
    const roll = state.currentRoll!
    const whiteSum = roll.white1.value + roll.white2.value
    const colorDie = roll.coloredRolls[color]

    if (isCurrentPlayer) {
      const colorPlusWhite1 = colorDie ? colorDie.value + roll.white1.value : null
      const colorPlusWhite2 = colorDie ? colorDie.value + roll.white2.value : null
      const isWhiteChoice = index === whiteSum
      const isColoredChoice = colorPlusWhite1 === index || colorPlusWhite2 === index
      if (!isWhiteChoice && !isColoredChoice) {
        return yield* Effect.fail(
          new InvalidMove({ message: `${index} does not match any valid dice combination`, playerId })
        )
      }
    } else {
      // Non-rolling players can only use white dice sum
      if (index !== whiteSum) {
        return yield* Effect.fail(
          new InvalidMove({
            message: `Non-rolling players may only use the white dice sum (${whiteSum})`,
            playerId,
          })
        )
      }
    }

    let updatedCard = yield* cardMove(player.card, color, rowIndex, playerId)

    // Auto-lock if reaching 12 (LOW_TO_HIGH) or 2 (high-to-low) with 5+ marks
    const isLockPosition = LOW_TO_HIGH[color] ? rowIndex === 10 : rowIndex === 0
    if (isLockPosition && rowCanLock(updatedCard.rows[color]!)) {
      updatedCard = cardLock(updatedCard, color)
    }

    return {
      ...state,
      flixxPlayers: { ...state.flixxPlayers, [playerId]: { card: updatedCard } },
    }
  })
}

// ---------------------------------------------------------------------------
// Round advancement
// ---------------------------------------------------------------------------

function nextRoundFlixx(state: FlixxGame, _config: GameConfig): FlixxGame {
  const playerCount = Object.keys(state.flixxPlayers).length
  const next = (state.currentPlayerIndex + 1) % playerCount
  return {
    ...state,
    rolled: false,
    currentChoice: { kind: "none" } as CurrentPlayerChoice,
    playersSubmittedForRound: [],
    currentPlayerIndex: next,
  }
}

function isReadyForNextRound(state: FlixxGame): boolean {
  const playerCount = Object.keys(state.flixxPlayers).length
  return state.playersSubmittedForRound.length >= playerCount && isChoiceDone(state.currentChoice)
}

function isChoiceDone(choice: CurrentPlayerChoice): boolean {
  return choice.kind === "none"
}

function advanceRound(state: FlixxGame): FlixxGame {
  const playerCount = Object.keys(state.flixxPlayers).length
  const next = (state.currentPlayerIndex + 1) % playerCount
  return {
    ...state,
    rolled: false,
    currentChoice: { kind: "none" } as CurrentPlayerChoice,
    playersSubmittedForRound: [],
    currentPlayerIndex: next,
  }
}

// ---------------------------------------------------------------------------
// Terminal conditions
// ---------------------------------------------------------------------------

export function isRoundOverFlixx(state: FlixxGame): boolean {
  const playerCount = Object.keys(state.flixxPlayers).length
  const anyGameOver = Object.values(state.flixxPlayers).some(p => isPlayerGameOver(p))
  return anyGameOver && state.playersSubmittedForRound.length >= playerCount
}

function isGameOverFlixx(state: FlixxGame): boolean {
  return isRoundOverFlixx(state)
}

function isPlayerGameOver(player: FlixxPlayer): boolean {
  const lockedCount = ALL_FLIXX_COLORS.filter(c => player.card.rows[c]?.locked).length
  return lockedCount >= 2 || player.card.numPenalties >= 4
}

// ---------------------------------------------------------------------------
// Derived helpers (used by frontend)
// ---------------------------------------------------------------------------

export function lockedColors(state: FlixxGame): Set<FlixxColor> {
  const locked = new Set<FlixxColor>()
  for (const player of Object.values(state.flixxPlayers)) {
    for (const color of ALL_FLIXX_COLORS) {
      if (player.card.rows[color]?.locked) locked.add(color)
    }
  }
  return locked
}

export function isUnavailable(state: FlixxGame, playerId: string, color: FlixxColor, realIndex: number): boolean {
  const player = state.flixxPlayers[playerId as PlayerId]
  if (!player) return true
  const rowIndex = LOW_TO_HIGH[color] ? realIndex - 2 : 12 - realIndex
  return cardUnavailable(player.card, color, rowIndex)
}

export function playerScore(player: FlixxPlayer): number {
  return cardCurrentScore(player.card)
}

// ---------------------------------------------------------------------------
// GameFunctions implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stat hooks
// ---------------------------------------------------------------------------

function flixxOnGameEnd(state: FlixxGame, _config: GameConfig): StatEntry[] {
  const entries: StatEntry[] = []
  const playerIds = Object.keys(state.flixxPlayers)

  // Find highest scorer
  let maxScore = -Infinity
  let winnerId = playerIds[0]!
  for (const pid of playerIds) {
    const score = cardCurrentScore(state.flixxPlayers[pid as PlayerId]!.card)
    if (score > maxScore) {
      maxScore = score
      winnerId = pid
    }
  }

  for (const pid of playerIds) {
    const score = cardCurrentScore(state.flixxPlayers[pid as PlayerId]!.card)
    entries.push({ playerId: pid, gameType: "Flixx", stat: "flixx_game_score", value: score })

    if (pid === winnerId) {
      entries.push({ playerId: pid, gameType: "Flixx", stat: "flixx_win", value: 1 })
    }
  }

  return entries
}

// ---------------------------------------------------------------------------
// GameFunctions implementation
// ---------------------------------------------------------------------------

export const flixxFunctions: GameFunctions<FlixxGame, FlixxEvent> = {
  gameType: "Flixx",

  initialState: (config, players) =>
    Effect.succeed(initFlixx(players, config)),

  next: (state, config, playerId, event) =>
    nextFlixx(state, config, playerId, event),

  nextRound: (state, config) =>
    Effect.succeed(nextRoundFlixx(state, config)),

  isRoundOver: (state) => isRoundOverFlixx(state),

  isGameOver: (state) => isGameOverFlixx(state),

  onGameEnd: flixxOnGameEnd,
}
