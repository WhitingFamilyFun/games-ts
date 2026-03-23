import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import {
  GameState,
  GameEvent,
  Lobby,
  GameInfo,
  CreateGameRequest,
  CreateGameResponse,
  JoinGameRequest,
  JoinGameResponse,
  StartGameRequest,
  StartGameResponse,
  SendEventRequest,
  SendEventResponse,
  NextRoundRequest,
  NextRoundResponse,
  DeleteGameRequest,
  DeleteGameResponse,
  GetGamesRequest,
  GetGamesResponse,
} from "./api.js"

// Minimal FlyloGame payload used across tests
const flyloGamePayload = {
  type: "Flylo",
  status: "started",
  round: 1,
  players: [{ id: "p1", name: "Alice" }],
  playerIds: ["p1"],
  flyloPlayers: [{ deck: { cards: [] }, card: null }],
  discardPile: { cards: [] },
  drawPile: { cards: [] },
  currentPlayerIndex: 0,
}

// Minimal FlixxGame payload used across tests
const flixxGamePayload = {
  type: "Flixx",
  status: "lobby",
  round: 0,
  players: [{ id: "p2", name: "Bob" }],
  flixxPlayers: {},
  currentPlayerIndex: 0,
}

describe("GameState discriminated union", () => {
  it("decodes a FlyloGame and exposes GenericFields", () => {
    const state = Schema.decodeUnknownSync(GameState)(flyloGamePayload)
    expect(state.type).toBe("Flylo")
    // GenericFields are accessible without narrowing
    expect(state.status).toBe("started")
    expect(state.round).toBe(1)
    expect(state.players).toHaveLength(1)
    expect(state.readyPlayers).toEqual([])
    expect(state.rewards).toEqual([])
    // Flylo-specific field available after narrowing
    if (state.type === "Flylo") {
      expect(state.flyloPlayers).toHaveLength(1)
      expect(state.discardPile.cards).toEqual([])
    }
  })

  it("decodes a FlixxGame and exposes GenericFields", () => {
    const state = Schema.decodeUnknownSync(GameState)(flixxGamePayload)
    expect(state.type).toBe("Flixx")
    // GenericFields are accessible without narrowing
    expect(state.status).toBe("lobby")
    expect(state.round).toBe(0)
    expect(state.players).toHaveLength(1)
    // Flixx-specific field available after narrowing
    if (state.type === "Flixx") {
      expect(state.flixxPlayers).toEqual({})
      expect(state.currentPlayerIndex).toBe(0)
    }
  })

  it("rejects an unknown type", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameState)({ ...flyloGamePayload, type: "Unknown" })
    ).toThrow()
  })

  it("round-trips a FlyloGame", () => {
    const state = Schema.decodeUnknownSync(GameState)(flyloGamePayload)
    const encoded = Schema.encodeSync(GameState)(state)
    const state2 = Schema.decodeUnknownSync(GameState)(encoded)
    expect(state2.type).toBe("Flylo")
    expect(state2.status).toBe(state.status)
    expect(state2.round).toBe(state.round)
  })

  it("round-trips a FlixxGame", () => {
    const state = Schema.decodeUnknownSync(GameState)(flixxGamePayload)
    const encoded = Schema.encodeSync(GameState)(state)
    const state2 = Schema.decodeUnknownSync(GameState)(encoded)
    expect(state2.type).toBe("Flixx")
    expect(state2.status).toBe(state.status)
  })
})

describe("GameEvent discriminated union", () => {
  it("decodes a FlyloDrawEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "draw", fromDiscard: false })
    expect(e.kind).toBe("draw")
    if (e.kind === "draw") expect(e.fromDiscard).toBe(false)
  })

  it("decodes a FlyloFlipEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "flip", index: 2 })
    expect(e.kind).toBe("flip")
  })

  it("decodes a FlyloDiscardEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "discard" })
    expect(e.kind).toBe("discard")
  })

  it("decodes a FlyloReplaceEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "replace", index: 4 })
    expect(e.kind).toBe("replace")
  })

  it("decodes a FlixxRollEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "roll" })
    expect(e.kind).toBe("roll")
  })

  it("decodes a FlixxPassEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "pass" })
    expect(e.kind).toBe("pass")
  })

  it("decodes a FlixxTakePenaltyEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "takePenalty" })
    expect(e.kind).toBe("takePenalty")
  })

  it("decodes a FlixxTakeRollEvent", () => {
    const e = Schema.decodeUnknownSync(GameEvent)({ kind: "takeRoll", color: "green", index: 7 })
    expect(e.kind).toBe("takeRoll")
    if (e.kind === "takeRoll") {
      expect(e.color).toBe("green")
      expect(e.index).toBe(7)
    }
  })

  it("rejects an unknown event kind", () => {
    expect(() => Schema.decodeUnknownSync(GameEvent)({ kind: "unknown" })).toThrow()
  })
})

describe("Lobby schema", () => {
  const lobbyPayload = {
    code: "ABCD",
    config: { gameType: "Flylo" },
    gameStatus: "lobby",
    players: [{ id: "p1", name: "Alice" }],
  }

  it("decodes a lobby", () => {
    const lobby = Schema.decodeUnknownSync(Lobby)(lobbyPayload)
    expect(lobby.code).toBe("ABCD")
    expect(lobby.gameStatus).toBe("lobby")
    expect(lobby.players).toHaveLength(1)
    expect(lobby.config.gameType).toBe("Flylo")
  })

  it("round-trips a lobby", () => {
    const lobby = Schema.decodeUnknownSync(Lobby)(lobbyPayload)
    const encoded = Schema.encodeSync(Lobby)(lobby)
    const lobby2 = Schema.decodeUnknownSync(Lobby)(encoded)
    expect(lobby2.code).toBe(lobby.code)
    expect(lobby2.gameStatus).toBe(lobby.gameStatus)
    expect(lobby2.players).toHaveLength(lobby.players.length)
  })

  it("rejects invalid gameStatus", () => {
    expect(() =>
      Schema.decodeUnknownSync(Lobby)({ ...lobbyPayload, gameStatus: "invalid" })
    ).toThrow()
  })
})

describe("GameInfo schema", () => {
  const gameInfoPayload = {
    gameID: "ABCD",
    status: "started",
    creator: "p1",
    config: { gameType: "Flixx" },
    player: { id: "p2", name: "Bob" },
    players: [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
  }

  it("decodes a GameInfo", () => {
    const info = Schema.decodeUnknownSync(GameInfo)(gameInfoPayload)
    expect(info.gameID).toBe("ABCD")
    expect(info.creator).toBe("p1")
    expect(info.players).toHaveLength(2)
  })

  it("round-trips a GameInfo", () => {
    const info = Schema.decodeUnknownSync(GameInfo)(gameInfoPayload)
    const encoded = Schema.encodeSync(GameInfo)(info)
    const info2 = Schema.decodeUnknownSync(GameInfo)(encoded)
    expect(info2.gameID).toBe(info.gameID)
    expect(info2.status).toBe(info.status)
    expect(info2.creator).toBe(info.creator)
  })
})

describe("API Request/Response schemas", () => {
  it("CreateGameRequest round-trip", () => {
    const req = Schema.decodeUnknownSync(CreateGameRequest)({
      playerID: "player1",
      config: { gameType: "Flylo" },
    })
    expect(req.playerID).toBe("player1")
    const encoded = Schema.encodeSync(CreateGameRequest)(req)
    const req2 = Schema.decodeUnknownSync(CreateGameRequest)(encoded)
    expect(req2.playerID).toBe(req.playerID)
    expect(req2.config.gameType).toBe("Flylo")
  })

  it("CreateGameResponse round-trip", () => {
    const res = Schema.decodeUnknownSync(CreateGameResponse)({ code: "WXYZ" })
    expect(res.code).toBe("WXYZ")
    const encoded = Schema.encodeSync(CreateGameResponse)(res)
    const res2 = Schema.decodeUnknownSync(CreateGameResponse)(encoded)
    expect(res2.code).toBe(res.code)
  })

  it("JoinGameRequest decodes correctly", () => {
    const req = Schema.decodeUnknownSync(JoinGameRequest)({
      code: "ABCD",
      playerID: "p1",
      name: "Alice",
    })
    expect(req.code).toBe("ABCD")
    expect(req.name).toBe("Alice")
  })

  it("JoinGameResponse decodes correctly", () => {
    const res = Schema.decodeUnknownSync(JoinGameResponse)({ name: "Alice" })
    expect(res.name).toBe("Alice")
  })

  it("StartGameRequest/Response round-trip", () => {
    const req = Schema.decodeUnknownSync(StartGameRequest)({ code: "ABCD", playerID: "p1" })
    expect(req.code).toBe("ABCD")
    const res = Schema.decodeUnknownSync(StartGameResponse)({ state: flyloGamePayload })
    expect(res.state.type).toBe("Flylo")
    // GenericFields accessible on response state
    expect(res.state.status).toBe("started")
    expect(res.state.round).toBe(1)
  })

  it("SendEventRequest/Response round-trip with Flixx state", () => {
    const req = Schema.decodeUnknownSync(SendEventRequest)({
      code: "ABCD",
      playerID: "p1",
      event: { kind: "roll" },
    })
    expect(req.event.kind).toBe("roll")
    const res = Schema.decodeUnknownSync(SendEventResponse)({ state: flixxGamePayload })
    expect(res.state.type).toBe("Flixx")
    expect(res.state.status).toBe("lobby")
  })

  it("NextRoundRequest/Response round-trip", () => {
    const req = Schema.decodeUnknownSync(NextRoundRequest)({ code: "ABCD", playerID: "p1" })
    expect(req.playerID).toBe("p1")
    const res = Schema.decodeUnknownSync(NextRoundResponse)({ state: flyloGamePayload })
    expect(res.state.type).toBe("Flylo")
  })

  it("DeleteGameRequest/Response round-trip", () => {
    const req = Schema.decodeUnknownSync(DeleteGameRequest)({ code: "ABCD", playerID: "p1" })
    expect(req.code).toBe("ABCD")
    const res = Schema.decodeUnknownSync(DeleteGameResponse)({ success: true })
    expect(res.success).toBe(true)
  })

  it("GetGamesRequest/Response round-trip", () => {
    const req = Schema.decodeUnknownSync(GetGamesRequest)({ playerID: "p1" })
    expect(req.playerID).toBe("p1")
    const res = Schema.decodeUnknownSync(GetGamesResponse)({
      games: [
        {
          gameID: "ABCD",
          status: "lobby",
          creator: "p1",
          config: { gameType: "Flylo" },
          player: { id: "p1", name: "Alice" },
          players: [{ id: "p1", name: "Alice" }],
        },
      ],
    })
    expect(res.games).toHaveLength(1)
    expect(res.games[0].gameID).toBe("ABCD")
    expect(res.games[0].creator).toBe("p1")
  })
})
