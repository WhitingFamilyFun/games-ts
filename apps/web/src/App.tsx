import type {
    FlixxColor,
    FlixxGame,
    FlyloGame,
    GameConfig,
    GameEvent,
    GameInfo,
    GameState,
    Lobby,
    Player,
    PlayerId,
    GameCode,
} from '@games/effect-schemas';
import {
    ALL_FLIXX_COLORS,
    CARD_VALUES,
    deckVisibleTotal,
    isGameOverFlylo,
    isRoundOverFlixx,
    isRoundOverFlylo,
    isUnavailable,
    LOW_TO_HIGH,
    playerScore,
} from '@games/game-engine';
import type { CardNum } from '@games/effect-schemas';
import { useAtomSet, useAtomValue } from '@effect-atom/atom-react';
import { useCallback, useEffect, useState } from 'react';
import { splitScreenAtom } from './atoms/session.js';
import {
    createGameAtom,
    joinGameAtom,
    deleteGameAtom,
    getGamesAtom,
    getRoomAtom,
    startGameAtom,
    sendEventAtom,
    nextRoundAtom,
} from './atoms/game.js';
import type { RoomSnapshot } from '@games/game-services';

type PaneSession = {
    playerId: string;
    playerName: string;
    code: string;
};

function makePlayerId(paneId: string): string {
    return `${paneId}-${crypto.randomUUID().slice(0, 8)}`;
}

function usePaneSession(paneId: string): [PaneSession, (updater: (value: PaneSession) => PaneSession) => void] {
    const storageKey = `whiting-games:${paneId}`;
    const [session, setSession] = useState<PaneSession>(() => {
        const stored = globalThis.localStorage?.getItem(storageKey);
        if (stored) {
            return JSON.parse(stored) as PaneSession;
        }
        return {
            playerId: makePlayerId(paneId),
            playerName: paneId === 'left' ? 'Player One' : 'Player Two',
            code: '',
        };
    });

    useEffect(() => {
        globalThis.localStorage?.setItem(storageKey, JSON.stringify(session));
    }, [session, storageKey]);

    return [session, updater => setSession(current => updater(current))];
}

function playerLabel(player: Player, session: PaneSession): string {
    return player.id === session.playerId ? `${player.name} (You)` : player.name;
}

function flyloPlayerReady(game: FlyloGame, playerIndex: number): boolean {
    const player = game.flyloPlayers[playerIndex];
    if (!player) {
        return false;
    }
    return player.deck.cards.filter(card => card.flipped).length >= 2;
}

function flyloSetupDone(game: FlyloGame): boolean {
    return game.flyloPlayers.every((_, index) => flyloPlayerReady(game, index));
}

function flyloCardColorClass(cardNum: CardNum): string {
    if (cardNum === 'm2' || cardNum === 'm1') return 'flylo-dark-blue';
    if (cardNum === 'z') return 'flylo-green';
    const val = CARD_VALUES[cardNum];
    if (val >= 1 && val <= 4) return 'flylo-light-blue';
    if (val >= 5 && val <= 8) return 'flylo-yellow';
    return 'flylo-red';
}

function flyloHelpText(game: FlyloGame, session: PaneSession, setupDone: boolean, roundOver: boolean, gameOver: boolean): string {
    if (gameOver) return 'Game over!';
    if (roundOver) return 'Round over!';
    const ownIndex = game.playerIds.indexOf(session.playerId as PlayerId);
    const ownPlayer = ownIndex >= 0 ? game.flyloPlayers[ownIndex] : null;
    if (!setupDone) return 'Flip 2 cards to start';
    if (!ownPlayer) return '';
    if (ownPlayer.discardToFlip) return 'Flip a face-down card';
    if (ownPlayer.card) return 'Replace a card in your grid or discard';
    const currentPlayerId = game.playerIds[game.currentPlayerIndex] ?? '';
    if (currentPlayerId === session.playerId) return 'Draw a card from deck or discard';
    return `Waiting for ${game.playerIds[game.currentPlayerIndex] ? 'other player' : 'unknown'}...`;
}

const FLIXX_ROW_COLORS: Record<string, string> = {
    red: '#c62828',
    yellow: '#f9a825',
    green: '#2e7d32',
    blue: '#0288d1',
    purple: '#7b1fa2',
};

function AppPane({ paneId, title }: { paneId: string; title: string }) {
    const [session, setSession] = usePaneSession(paneId);
    const [room, setRoom] = useState<RoomSnapshot | null>(null);
    const [games, setGames] = useState<readonly GameInfo[]>([]);
    const [message, setMessage] = useState<string>('');
    const [joinCode, setJoinCode] = useState(session.code);

    // Action atoms in promise mode — each returns a promise that resolves with the success value
    const doCreateGame = useAtomSet(createGameAtom, { mode: 'promise' });
    const doJoinGame = useAtomSet(joinGameAtom, { mode: 'promise' });
    const doDeleteGame = useAtomSet(deleteGameAtom, { mode: 'promise' });
    const doGetGames = useAtomSet(getGamesAtom, { mode: 'promise' });
    const doGetRoom = useAtomSet(getRoomAtom, { mode: 'promise' });
    const doStartGame = useAtomSet(startGameAtom, { mode: 'promise' });
    const doSendEvent = useAtomSet(sendEventAtom, { mode: 'promise' });
    const doNextRound = useAtomSet(nextRoundAtom, { mode: 'promise' });

    // Refresh the games list for this player
    const refreshGames = useCallback(async () => {
        try {
            const result = await doGetGames(session.playerId as PlayerId);
            setGames(result);
        } catch {
            // silently ignore — games list is informational
        }
    }, [doGetGames, session.playerId]);

    // Refresh room state from the backend
    const refreshRoom = useCallback(async (code: string) => {
        if (!code) {
            setRoom(null);
            return;
        }
        try {
            const snapshot = await doGetRoom(code as GameCode);
            setRoom(snapshot);
        } catch {
            setRoom(null);
        }
    }, [doGetRoom]);

    // Fetch games and room on mount and when session changes
    useEffect(() => {
        void refreshGames();
    }, [refreshGames]);

    useEffect(() => {
        void refreshRoom(session.code);
    }, [session.code, refreshRoom]);

    // Poll room state every 2s while in a game (so other pane's actions show up)
    useEffect(() => {
        if (!session.code) return;
        const interval = setInterval(() => {
            void refreshRoom(session.code);
        }, 2000);
        return () => clearInterval(interval);
    }, [session.code, refreshRoom]);

    async function runAction(action: () => Promise<void>) {
        try {
            setMessage('');
            await action();
        } catch (error: unknown) {
            console.error('Action error:', error);
            const msg = error instanceof Error
                ? error.message
                : typeof error === 'object' && error !== null && '_tag' in error
                    ? `${(error as { _tag: string })._tag}: ${JSON.stringify(error)}`
                    : String(error);
            setMessage(msg || 'Something went wrong');
        }
    }

    async function createGame(gameType: 'Flylo' | 'Flixx') {
        const config: GameConfig = {
            gameType,
            adminID: session.playerId as PlayerId,
            rounds: 1,
            minPlayers: 2,
            maxPlayers: 20,
            options: { randomSeed: 7 },
        };
        const code = await doCreateGame({ playerId: session.playerId as PlayerId, config });
        await doJoinGame({ playerId: session.playerId as PlayerId, code, name: session.playerName.trim() || title });
        setSession(current => ({ ...current, code }));
        setJoinCode(code);
        await refreshRoom(code);
        void refreshGames();
    }

    async function joinGame() {
        const code = joinCode.trim().toUpperCase() as GameCode;
        await doJoinGame({ playerId: session.playerId as PlayerId, code, name: session.playerName.trim() || title });
        setSession(current => ({ ...current, code }));
        await refreshRoom(code);
        void refreshGames();
    }

    async function leavePane() {
        setSession(current => ({ ...current, code: '' }));
        setJoinCode('');
        setMessage('');
        setRoom(null);
    }

    return (
        <section className="pane">
            <header className="pane-header">
                <div>
                    <h2>{title}</h2>
                    <p className="muted">Local pane identity stays isolated for split-screen testing.</p>
                </div>
                <div className="info-pill">ID {session.playerId.slice(0, 6)}</div>
            </header>
            <div className="pane-body">
                <label className="stack">
                    <span className="muted">Display name</span>
                    <input
                        value={session.playerName}
                        onChange={event => setSession(current => ({ ...current, playerName: event.target.value }))}
                        placeholder="Player name"
                    />
                </label>

                {message ? <div className="error-banner">{message}</div> : null}

                {!room ? (
                    <HomeView
                        games={games}
                        joinCode={joinCode}
                        onJoinCodeChange={setJoinCode}
                        onCreate={gameType => runAction(() => createGame(gameType))}
                        onJoin={() => runAction(joinGame)}
                        onResume={code => {
                            setSession(current => ({ ...current, code }));
                            setJoinCode(code);
                            void refreshRoom(code);
                        }}
                    />
                ) : room.lobby.gameStatus === 'lobby' ? (
                    <LobbyView
                        lobby={room.lobby}
                        session={session}
                        onLeave={() => runAction(leavePane)}
                        onDelete={() => runAction(async () => {
                            await doDeleteGame({ playerId: session.playerId as PlayerId, code: room.lobby.code });
                            await leavePane();
                            void refreshGames();
                        })}
                        onStart={() => runAction(async () => {
                            const state = await doStartGame({ playerId: session.playerId as PlayerId, code: room.lobby.code });
                            setRoom({ lobby: { ...room.lobby, gameStatus: 'started' }, state });
                        })}
                    />
                ) : room.state?.type === 'Flylo' ? (
                    <FlyloView
                        lobby={room.lobby}
                        session={session}
                        game={room.state}
                        onLeave={() => runAction(leavePane)}
                        onAction={runAction}
                        onSendEvent={async (event: GameEvent) => {
                            const state = await doSendEvent({ playerId: session.playerId as PlayerId, code: room.lobby.code, event });
                            setRoom(prev => prev ? { ...prev, state } : prev);
                        }}
                        onNextRound={async () => {
                            const state = await doNextRound({ playerId: session.playerId as PlayerId, code: room.lobby.code });
                            setRoom(prev => prev ? { ...prev, state } : prev);
                        }}
                    />
                ) : room.state?.type === 'Flixx' ? (
                    <FlixxView
                        lobby={room.lobby}
                        session={session}
                        game={room.state}
                        onLeave={() => runAction(leavePane)}
                        onAction={runAction}
                        onSendEvent={async (event: GameEvent) => {
                            const state = await doSendEvent({ playerId: session.playerId as PlayerId, code: room.lobby.code, event });
                            setRoom(prev => prev ? { ...prev, state } : prev);
                        }}
                    />
                ) : (
                    <div className="summary-panel">Waiting for game state...</div>
                )}
            </div>
        </section>
    );
}

function HomeView({
    games,
    joinCode,
    onJoinCodeChange,
    onCreate,
    onJoin,
    onResume,
}: {
    games: readonly GameInfo[];
    joinCode: string;
    onJoinCodeChange: (value: string) => void;
    onCreate: (gameType: 'Flylo' | 'Flixx') => void;
    onJoin: () => void;
    onResume: (code: string) => void;
}) {
    return (
        <>
            <div className="summary-panel">
                <h3>Create</h3>
                <p className="muted">
                    Client-only build. Backend mode: Effect services (in-browser mock or Firebase).
                </p>
                <div className="actions">
                    <button onClick={() => onCreate('Flylo')}>Create Flylo</button>
                    <button onClick={() => onCreate('Flixx')}>Create Flixx</button>
                </div>
            </div>

            <div className="summary-panel">
                <h3>Join</h3>
                <div className="actions">
                    <input value={joinCode} onChange={event => onJoinCodeChange(event.target.value.toUpperCase())} maxLength={4} placeholder="Game code" />
                    <button onClick={onJoin} disabled={joinCode.trim().length !== 4}>Join Game</button>
                </div>
            </div>

            <div className="summary-panel">
                <h3>My Games</h3>
                {games.length === 0 ? <p className="muted">No active games for this pane yet.</p> : null}
                <div className="players">
                    {games.map(game => (
                        <button key={game.gameID} onClick={() => onResume(game.gameID)}>
                            {game.config.gameType} {game.gameID}
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}

function LobbyView({
    lobby,
    session,
    onStart,
    onDelete,
    onLeave,
}: {
    lobby: Lobby;
    session: PaneSession;
    onStart: () => void;
    onDelete: () => void;
    onLeave: () => void;
}) {
    const isAdmin = lobby.config.adminID === session.playerId;

    return (
        <>
            <div className="summary-panel">
                <h3>{lobby.config.gameType} Lobby</h3>
                <div className="status-row">
                    <span className="info-pill">Code {lobby.code}</span>
                    <span className="info-pill">Players {lobby.players.length}</span>
                </div>
            </div>

            <div className="players">
                {lobby.players.map(player => (
                    <div key={player.id} className={`player-tile${player.id === session.playerId ? ' self' : ''}`}>
                        <h3>{playerLabel(player, session)}</h3>
                        <p className="muted">{player.id === lobby.config.adminID ? 'Creator' : 'Joined player'}</p>
                    </div>
                ))}
            </div>

            <div className="lobby-actions">
                <button onClick={onLeave}>Leave Pane</button>
                <button onClick={onStart} disabled={!isAdmin || lobby.players.length < 2}>Start Game</button>
                <button onClick={onDelete} disabled={!isAdmin}>Delete Game</button>
            </div>
        </>
    );
}

function FlyloView({
    lobby,
    session,
    game,
    onLeave,
    onAction,
    onSendEvent,
    onNextRound,
}: {
    lobby: Lobby;
    session: PaneSession;
    game: FlyloGame;
    onLeave: () => void;
    onAction: (action: () => Promise<void>) => Promise<void>;
    onSendEvent: (event: GameEvent) => Promise<void>;
    onNextRound: () => Promise<void>;
}) {
    const ownIndex = game.playerIds.indexOf(session.playerId as PlayerId);
    const ownPlayer = ownIndex >= 0 ? game.flyloPlayers[ownIndex] : null;
    const currentPlayerId = game.playerIds[game.currentPlayerIndex] ?? '';
    const setupDone = flyloSetupDone(game);
    const roundOver = isRoundOverFlylo(game);
    const gameOver = isGameOverFlylo(game, lobby.config);

    function sendEvent(event: GameEvent) {
        return onAction(() => onSendEvent(event));
    }

    function pressOwnCard(index: number) {
        if (!ownPlayer) {
            return;
        }
        if (!setupDone || ownPlayer.discardToFlip) {
            void sendEvent({ kind: 'flip', index });
            return;
        }
        if (ownPlayer.card) {
            void sendEvent({ kind: 'replace', index });
        }
    }

    const topDiscard = game.discardPile.cards.at(-1);
    const helpText = flyloHelpText(game, session, setupDone, roundOver, gameOver);
    const allFlipped = (deck: { cards: readonly { flipped: boolean }[] }) => deck.cards.every(c => c.flipped);

    return (
        <>
            <div className="summary-panel">
                <h3>Flylo</h3>
                <div className="status-row">
                    <span className="info-pill">Code {lobby.code}</span>
                    <span className="info-pill">Round {game.round + 1}</span>
                    <span className="info-pill">Current {lobby.players.find(player => player.id === currentPlayerId)?.name ?? 'Unknown'}</span>
                </div>
            </div>

            {/* Draw / Discard / Held visual area */}
            <div className="flylo-piles">
                <div className="pile-group">
                    <span className="pile-label">Draw Pile</span>
                    <div className="flylo-card face-down pile-card">?</div>
                </div>
                <div className="pile-group">
                    <span className="pile-label">Discard</span>
                    {topDiscard ? (
                        <div className={`flylo-card face-up pile-card ${flyloCardColorClass(topDiscard.number)}`}>
                            {topDiscard.number}
                        </div>
                    ) : (
                        <div className="flylo-card face-down pile-card">empty</div>
                    )}
                </div>
                {ownPlayer?.card ? (
                    <div className="pile-group">
                        <span className="pile-label">Held</span>
                        <div className={`flylo-card face-up pile-card ${flyloCardColorClass(ownPlayer.card.number)}`}>
                            {ownPlayer.card.number}
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="actions">
                <button onClick={() => void sendEvent({ kind: 'draw', fromDiscard: false })} disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !!ownPlayer?.card || !!ownPlayer?.discardToFlip}>Draw Deck</button>
                <button onClick={() => void sendEvent({ kind: 'draw', fromDiscard: true })} disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !!ownPlayer?.card || !!ownPlayer?.discardToFlip}>Draw Discard</button>
                <button onClick={() => void sendEvent({ kind: 'discard' })} disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !ownPlayer?.card}>Discard Held</button>
                <button onClick={() => void onAction(() => onNextRound())} disabled={!roundOver || gameOver}>Next Round</button>
                <button onClick={onLeave}>Leave Pane</button>
            </div>

            <p className="help-text">{helpText}</p>

            {/* Round Over banner */}
            {roundOver ? (
                <div className="round-over-banner">
                    <h3>{gameOver ? 'Game Over!' : 'Round Over!'}</h3>
                    <div className="round-scores">
                        {lobby.players.map((player, index) => {
                            const fp = game.flyloPlayers[index];
                            if (!fp) return null;
                            const roundScore = allFlipped(fp.deck) ? deckVisibleTotal(fp.deck) : deckVisibleTotal(fp.deck);
                            return (
                                <div key={player.id} className="round-score-entry">
                                    <span>{playerLabel(player, session)}</span>
                                    <span>Round: {roundScore}</span>
                                    <span>Total: {fp.currentScore}</span>
                                </div>
                            );
                        })}
                    </div>
                    {!gameOver ? (
                        <button onClick={() => void onAction(() => onNextRound())}>Next Round</button>
                    ) : null}
                </div>
            ) : null}

            <div className="players">
                {lobby.players.map((player, index) => {
                    const flyloPlayer = game.flyloPlayers[index];
                    const isSelf = player.id === session.playerId;
                    const isCurrent = player.id === currentPlayerId;
                    if (!flyloPlayer) {
                        return null;
                    }
                    const hasHiddenCards = flyloPlayer.deck.cards.some(c => !c.flipped);
                    const roundScore = hasHiddenCards ? '?' : String(deckVisibleTotal(flyloPlayer.deck));
                    return (
                        <div key={player.id} className={`card-panel player-tile${isSelf ? ' self' : ''}${isCurrent ? ' current' : ''}`}>
                            <h3>{playerLabel(player, session)}</h3>
                            <p className="muted">Round: {roundScore} · Overall: {flyloPlayer.currentScore}</p>
                            <div className="card-grid">
                                {flyloPlayer.deck.cards.map((card, cardIndex) => (
                                    <button
                                        key={`${player.id}-${cardIndex}`}
                                        className={`flylo-card ${card.flipped ? `face-up ${flyloCardColorClass(card.number)}` : 'face-down'}`}
                                        onClick={() => {
                                            if (isSelf) {
                                                pressOwnCard(cardIndex);
                                            }
                                        }}
                                        disabled={!isSelf || roundOver}
                                    >
                                        {card.flipped ? card.number : '?'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

function FlixxView({
    lobby,
    session,
    game,
    onLeave,
    onAction,
    onSendEvent,
}: {
    lobby: Lobby;
    session: PaneSession;
    game: FlixxGame;
    onLeave: () => void;
    onAction: (action: () => Promise<void>) => Promise<void>;
    onSendEvent: (event: GameEvent) => Promise<void>;
}) {
    const ownPlayer = game.flixxPlayers[session.playerId as PlayerId];
    const currentPlayer = lobby.players[game.currentPlayerIndex];
    const gameOver = isRoundOverFlixx(game);

    function sendEvent(event: GameEvent) {
        return onAction(() => onSendEvent(event));
    }

    return (
        <>
            <div className="summary-panel">
                <h3>Flixx</h3>
                <div className="roll-strip">
                    <span className="roll-pill">Current {currentPlayer?.name ?? 'Unknown'}</span>
                    <span className="roll-pill">W1 {game.currentRoll?.white1.value ?? '-'}</span>
                    <span className="roll-pill">W2 {game.currentRoll?.white2.value ?? '-'}</span>
                    {ALL_FLIXX_COLORS.map(color => (
                        <span key={color} className="roll-pill">{color} {game.currentRoll?.coloredRolls[color]?.value ?? '-'}</span>
                    ))}
                </div>
            </div>

            <div className="actions">
                <button onClick={() => void sendEvent({ kind: 'roll' })} disabled={currentPlayer?.id !== session.playerId || game.rolled || gameOver}>Roll</button>
                <button onClick={() => void sendEvent({ kind: 'takePenalty' })} disabled={currentPlayer?.id !== session.playerId || !game.rolled || gameOver}>Take Penalty</button>
                <button onClick={() => void sendEvent({ kind: 'pass' })} disabled={!game.rolled || gameOver}>Pass</button>
                <button onClick={onLeave}>Leave Pane</button>
            </div>

            <div className="scoreboard">
                {lobby.players.map(player => {
                    const flixxPlayer = game.flixxPlayers[player.id as PlayerId];
                    if (!flixxPlayer) {
                        return null;
                    }
                    return (
                        <div key={player.id} className={`player-tile${player.id === session.playerId ? ' self' : ''}${player.id === currentPlayer?.id ? ' current' : ''}`}>
                            <h3>{playerLabel(player, session)}</h3>
                            <p className="muted">Score {playerScore(flixxPlayer)} · Penalties {flixxPlayer.card.numPenalties}</p>
                        </div>
                    );
                })}
            </div>

            {ownPlayer ? (
                <div className="board-panel">
                    <h3>Your Card</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Color</th>
                                {Array.from({ length: 11 }, (_, index) => index + 2).map(value => (
                                    <th key={value}>{value}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ALL_FLIXX_COLORS.map((color: FlixxColor) => {
                                const row = ownPlayer.card.rows[color];
                                if (!row) {
                                    return null;
                                }
                                const rowBg = FLIXX_ROW_COLORS[color] ?? 'transparent';
                                return (
                                    <tr key={color} style={{ backgroundColor: `${rowBg}22` }}>
                                        <th style={{ backgroundColor: rowBg, color: '#fff', borderRadius: '8px' }}>{color}</th>
                                        {Array.from({ length: 11 }, (_, index) => index + 2).map(realIndex => {
                                            const visualIndex = LOW_TO_HIGH[color] ? realIndex : 14 - realIndex;
                                            const disabled = !game.rolled || isUnavailable(game, session.playerId, color, realIndex) || gameOver;
                                            return (
                                                <td key={`${color}-${realIndex}`}>
                                                    <button
                                                        className="flixx-cell"
                                                        onClick={() => void sendEvent({ kind: 'takeRoll', color, index: realIndex })}
                                                        disabled={disabled}
                                                    >
                                                        {row.row[LOW_TO_HIGH[color] ? realIndex - 2 : 12 - realIndex] ? 'X' : visualIndex}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </>
    );
}

export function App() {
    const splitScreen = useAtomValue(splitScreenAtom);
    const setSplitScreen = useAtomSet(splitScreenAtom);

    return (
        <main className="app-shell">
            <div className="topbar">
                <div className="title-block">
                    <h1>Whiting Games</h1>
                    <p>
                        Client-side React app with no SSR. Backend mode is selected by environment:
                        mock for in-browser testing or functions for Firebase Functions.
                    </p>
                </div>
                <div className="actions">
                    <button onClick={() => setSplitScreen(current => !current)}>{splitScreen ? 'Single Pane' : 'Split Screen'}</button>
                </div>
            </div>

            <div className={`pane-grid${splitScreen ? ' split' : ''}`}>
                <AppPane paneId="left" title="Pane A" />
                {splitScreen ? <AppPane paneId="right" title="Pane B" /> : null}
            </div>

            <p className="split-note">Split-screen mode keeps separate local player identities while both panes talk to the same in-browser service layer.</p>
        </main>
    );
}
