/**
 * Flylo card and deck utilities.
 * Ported from core-games, updated to use @games/effect-schemas types.
 */

import type { CardNum, Deck, GameCard } from "@games/effect-schemas"

// ---------------------------------------------------------------------------
// Card metadata
// ---------------------------------------------------------------------------

export const CARD_VALUES: Record<CardNum, number> = {
  m2: -2, m1: -1, z: 0,
  p1: 1, p2: 2, p3: 3, p4: 4,
  p5: 5, p6: 6, p7: 7, p8: 8,
  p9: 9, p10: 10, p11: 11, p12: 12,
}

export const CARD_QUANTITIES: Record<CardNum, number> = {
  m2: 5, m1: 10, z: 15,
  p1: 10, p2: 10, p3: 10, p4: 10,
  p5: 10, p6: 10, p7: 10, p8: 10,
  p9: 10, p10: 10, p11: 10, p12: 10,
}

export const CARD_NUMS = Object.keys(CARD_VALUES) as CardNum[]

// ---------------------------------------------------------------------------
// Deck helpers
// ---------------------------------------------------------------------------

/** Build the full 150-card deck (unshuffled). */
export function allCards(): Deck {
  const cards: GameCard[] = []
  for (const num of CARD_NUMS) {
    for (let i = 0; i < CARD_QUANTITIES[num]; i++) {
      cards.push({ number: num, flipped: false })
    }
  }
  return { cards }
}

export const emptyDeck: Deck = { cards: [] }

/**
 * Fisher-Yates shuffle. If seed is provided, uses a deterministic
 * mulberry32 PRNG so tests can be reproducible.
 */
export function shuffleDeck(deck: Deck, seed?: number): Deck {
  const cards = [...deck.cards]
  const rand = seed !== undefined ? seededRng(seed) : Math.random.bind(Math)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!]
  }
  return { cards }
}

/**
 * Draw the top card (index 0), returning the card face-up and the remaining deck.
 * Throws if the deck is empty.
 */
export function drawFromDeck(deck: Deck): { card: GameCard; deck: Deck } {
  if (deck.cards.length === 0) throw new Error("Cannot draw from empty deck")
  const [first, ...rest] = deck.cards
  return { card: { ...first!, flipped: true }, deck: { cards: rest } }
}

/**
 * Draw from the END of the deck (used for discard pile: last card is top).
 */
export function drawFromEnd(deck: Deck): { card: GameCard; deck: Deck } {
  if (deck.cards.length === 0) throw new Error("Cannot draw from empty deck")
  const card = deck.cards[deck.cards.length - 1]!
  return { card, deck: { cards: deck.cards.slice(0, -1) } }
}

export function addCard(deck: Deck, card: GameCard): Deck {
  return { cards: [...deck.cards, card] }
}

export function replaceCard(deck: Deck, index: number, card: GameCard): Deck {
  const cards = [...deck.cards]
  cards[index] = card
  return { cards }
}

export function flipCard(deck: Deck, index: number, forceDown?: boolean): Deck {
  const cards = deck.cards.map((c, i) => {
    if (i !== index) return c
    const flipped = forceDown !== undefined ? !forceDown : !c.flipped
    return { ...c, flipped }
  })
  return { cards }
}

export function flipAllCards(deck: Deck): Deck {
  return { cards: deck.cards.map(c => ({ ...c, flipped: true })) }
}

export function deckCardTotal(deck: Deck): number {
  return deck.cards.reduce((sum, c) => sum + CARD_VALUES[c.number], 0)
}

export function deckVisibleTotal(deck: Deck): number {
  return deck.cards
    .filter(c => c.flipped)
    .reduce((sum, c) => sum + CARD_VALUES[c.number], 0)
}

/** Returns true if any three consecutive cards in the deck share the same CardNum. */
export function hasThreesome(deck: Deck): boolean {
  for (let i = 0; i <= deck.cards.length - 3; i++) {
    if (
      deck.cards[i]!.number === deck.cards[i + 1]!.number &&
      deck.cards[i]!.number === deck.cards[i + 2]!.number
    ) return true
  }
  return false
}

export function threesomeStartIndex(deck: Deck): number {
  for (let i = 0; i <= deck.cards.length - 3; i++) {
    if (
      deck.cards[i]!.number === deck.cards[i + 1]!.number &&
      deck.cards[i]!.number === deck.cards[i + 2]!.number
    ) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Simple mulberry32 seeded PRNG
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
