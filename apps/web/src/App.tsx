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
    FLIXX_SCORE_MAP,
    isGameOverFlylo,
    isRoundOverFlixx,
    isRoundOverFlylo,
    isUnavailable,
    LOW_TO_HIGH,
    playerScore,
} from '@games/game-engine';
import type { CardNum } from '@games/effect-schemas';
import { useAtomSet, useAtomValue } from '@effect-atom/atom-react';
import { useCallback, useEffect, useState, useMemo, useRef, type TouchEvent as ReactTouchEvent } from 'react';
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

/** Display a card number as its numeric value (e.g. "m2" → "-2", "p5" → "5", "z" → "0") */
function cardDisplayValue(cardNum: CardNum): string {
    return String(CARD_VALUES[cardNum]);
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

    // Carousel: all players, starting with self
    const orderedPlayers = useMemo(() => {
        const selfIdx = lobby.players.findIndex(p => p.id === session.playerId);
        if (selfIdx === -1) return lobby.players.map((p, i) => ({ player: p, index: i }));
        const result = [];
        for (let i = 0; i < lobby.players.length; i++) {
            const idx = (selfIdx + i) % lobby.players.length;
            result.push({ player: lobby.players[idx]!, index: idx });
        }
        return result;
    }, [lobby.players, session.playerId]);

    const [carouselIdx, setCarouselIdx] = useState(0);
    const viewedIdx = carouselIdx % Math.max(orderedPlayers.length, 1);
    const viewed = orderedPlayers[viewedIdx];

    // Swipe handling
    const touchStartX = useRef<number | null>(null);
    const handleTouchStart = (e: ReactTouchEvent) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
    const handleTouchEnd = (e: ReactTouchEvent) => {
        if (touchStartX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 40) return; // too short
        if (dx < 0) setCarouselIdx(i => (i + 1) % orderedPlayers.length); // swipe left = next
        else setCarouselIdx(i => (i - 1 + orderedPlayers.length) % orderedPlayers.length); // swipe right = prev
    };

    return (
        <>
            <div className="summary-panel">
                <h3>Flylo</h3>
                <div className="status-row">
                    <span className="info-pill">Code {lobby.code}</span>
                    <span className="info-pill">Round {game.round}</span>
                    <span className="info-pill">Turn: {lobby.players.find(player => player.id === currentPlayerId)?.name ?? 'Unknown'}</span>
                </div>
            </div>

            {/* Draw / Discard / Held visual area */}
            <div className="flylo-piles">
                <div className="pile-group">
                    <span className="pile-label">Draw</span>
                    <button
                        className="flylo-card face-down pile-card"
                        onClick={() => void sendEvent({ kind: 'draw', fromDiscard: false })}
                        disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !!ownPlayer?.card || !!ownPlayer?.discardToFlip}
                    >?</button>
                </div>
                <div className="pile-group">
                    <span className="pile-label">{ownPlayer?.card ? 'Discard Here' : 'Discard'}</span>
                    {topDiscard ? (
                        <button
                            className={`flylo-card face-up pile-card ${flyloCardColorClass(topDiscard.number)}`}
                            onClick={() => {
                                if (ownPlayer?.card && !ownPlayer.fromDiscard) {
                                    // Holding a card drawn from deck → discard it
                                    void sendEvent({ kind: 'discard' });
                                } else if (!ownPlayer?.card && !ownPlayer?.discardToFlip) {
                                    // No held card → draw from discard
                                    void sendEvent({ kind: 'draw', fromDiscard: true });
                                }
                            }}
                            disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !!ownPlayer?.discardToFlip || (!!ownPlayer?.card && ownPlayer.fromDiscard)}
                        >{cardDisplayValue(topDiscard.number)}</button>
                    ) : (
                        <div className="flylo-card face-down pile-card">--</div>
                    )}
                </div>
                {ownPlayer?.card ? (
                    <div className="pile-group">
                        <span className="pile-label">Held</span>
                        <div className={`flylo-card face-up pile-card ${flyloCardColorClass(ownPlayer.card.number)}`}>
                            {cardDisplayValue(ownPlayer.card.number)}
                        </div>
                    </div>
                ) : null}
            </div>

            <p className="help-text">{helpText}</p>

            <div className="actions">
                <button onClick={() => void onAction(() => onNextRound())} disabled={!roundOver || gameOver}>Next Round</button>
                <button onClick={onLeave}>Leave</button>
            </div>

            {/* Round Over / Game Over banner */}
            {roundOver ? (() => {
                // Compute round scores (lowest wins)
                const entries = lobby.players.map((player, index) => {
                    const fp = game.flyloPlayers[index];
                    if (!fp) return null;
                    return { player, fp, roundScore: deckVisibleTotal(fp.deck), totalScore: fp.currentScore };
                }).filter(Boolean) as Array<{ player: Player; fp: NonNullable<typeof game.flyloPlayers[number]>; roundScore: number; totalScore: number }>;

                const roundWinner = entries.reduce((best, e) => e.roundScore < best.roundScore ? e : best, entries[0]!);
                const overallLeader = entries.reduce((best, e) => e.totalScore < best.totalScore ? e : best, entries[0]!);

                // Sort by total score ascending for game-over standings
                const sortedEntries = gameOver ? [...entries].sort((a, b) => a.totalScore - b.totalScore) : entries;

                return (
                    <div className={`round-over-banner${gameOver ? ' game-over' : ''}`}>
                        <h3>{gameOver ? 'Game Over!' : 'Round Over!'}</h3>
                        {/* Winner callouts */}
                        <div className="winner-callouts">
                            {roundWinner && <span className="winner-callout">Round winner: {roundWinner.player.name} ({roundWinner.roundScore} pts)</span>}
                            {overallLeader && <span className="winner-callout">Overall leader: {overallLeader.player.name} ({overallLeader.totalScore} pts total)</span>}
                        </div>
                        <div className="round-scores">
                            {sortedEntries.map((e, sortedIdx) => (
                                <div key={e.player.id} className={`round-score-entry${gameOver && sortedIdx === 0 ? ' winner' : ''}`}>
                                    <span>{playerLabel(e.player, session)}</span>
                                    <span>Round: {e.roundScore}</span>
                                    <span>Total: {e.totalScore}</span>
                                </div>
                            ))}
                        </div>
                        {!gameOver ? (
                            <button onClick={() => void onAction(() => onNextRound())}>Next Round</button>
                        ) : null}
                    </div>
                );
            })() : null}

            {/* Player hands — swipeable carousel, starting with self */}
            {viewed ? (() => {
                const { player: viewedPlayer, index: viewedPlayerIdx } = viewed;
                const flyloPlayer = game.flyloPlayers[viewedPlayerIdx];
                if (!flyloPlayer) return null;
                const isSelf = viewedPlayer.id === session.playerId;
                const isCurrent = viewedPlayer.id === currentPlayerId;
                const hasHidden = flyloPlayer.deck.cards.some(c => !c.flipped);
                return (
                    <div
                        className={`card-panel player-tile${isSelf ? ' self' : ''}${isCurrent ? ' current' : ''} carousel-panel`}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        <div className="player-hand-header">
                            <div className="carousel-nav">
                                <button className="carousel-btn" onClick={() => setCarouselIdx(i => (i - 1 + orderedPlayers.length) % orderedPlayers.length)}>&larr;</button>
                                <h3>
                                    {isSelf ? `${viewedPlayer.name} (You)` : viewedPlayer.name}
                                    {isCurrent ? ' · Turn' : ''}
                                </h3>
                                <button className="carousel-btn" onClick={() => setCarouselIdx(i => (i + 1) % orderedPlayers.length)}>&rarr;</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                                <span className="muted">Round: {hasHidden ? '?' : deckVisibleTotal(flyloPlayer.deck)} · Overall: {flyloPlayer.currentScore}</span>
                                {!setupDone && (
                                    flyloPlayerReady(game, viewedPlayerIdx)
                                        ? <span className="setup-status ready">Ready</span>
                                        : <span className="setup-status waiting">Flip 2 cards</span>
                                )}
                            </div>
                        </div>
                        <div className="carousel-dots">
                            {orderedPlayers.map((_, i) => (
                                <button
                                    key={i}
                                    className={`dot${i === viewedIdx ? ' active' : ''}`}
                                    onClick={() => setCarouselIdx(i)}
                                />
                            ))}
                        </div>
                        <div className="card-grid">
                            {flyloPlayer.deck.cards.map((card, cardIndex) => (
                                isSelf ? (
                                    <button
                                        key={`card-${cardIndex}`}
                                        className={`flylo-card ${card.flipped ? `face-up ${flyloCardColorClass(card.number)}` : 'face-down'}`}
                                        onClick={() => pressOwnCard(cardIndex)}
                                        disabled={roundOver}
                                    >
                                        {card.flipped ? cardDisplayValue(card.number) : '?'}
                                    </button>
                                ) : (
                                    <div
                                        key={`card-${cardIndex}`}
                                        className={`flylo-card ${card.flipped ? `face-up ${flyloCardColorClass(card.number)}` : 'face-down'}`}
                                    >
                                        {card.flipped ? cardDisplayValue(card.number) : '?'}
                                    </div>
                                )
                            ))}
                        </div>
                    </div>
                );
            })() : null}
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

    const white1 = game.currentRoll?.white1.value ?? null;
    const white2 = game.currentRoll?.white2.value ?? null;
    const whiteSum = white1 !== null && white2 !== null ? white1 + white2 : null;

    return (
        <>
            <div className="summary-panel">
                <h3>Flixx</h3>
                <span className="muted" style={{ fontSize: '0.9rem' }}>Current: {currentPlayer?.name ?? 'Unknown'}</span>
                {/* White sum prominent display */}
                {whiteSum !== null && (
                    <div style={{ marginTop: '0.4rem' }}>
                        <span className="white-sum-pill">White sum: {whiteSum}</span>
                    </div>
                )}
                {/* Visual dice */}
                <div className="dice-strip">
                    <span className="die-label">W1</span>
                    <span className={`die die-white`}>{white1 ?? '–'}</span>
                    <span className="die-label">W2</span>
                    <span className={`die die-white`}>{white2 ?? '–'}</span>
                    {ALL_FLIXX_COLORS.map(color => (
                        <span key={color} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                            <span className="die-label">{color[0]?.toUpperCase()}</span>
                            <span className={`die die-${color}`}>{game.currentRoll?.coloredRolls[color]?.value ?? '–'}</span>
                        </span>
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
                                const isLocked = row.locked;
                                const markCount = row.row.filter(Boolean).length;
                                const rowPoints = FLIXX_SCORE_MAP[markCount] ?? 0;
                                return (
                                    <tr key={color} className={isLocked ? 'flixx-row-locked' : ''} style={{ backgroundColor: isLocked ? `${rowBg}44` : `${rowBg}22` }}>
                                        <th className="row-name-cell" style={{ backgroundColor: isLocked ? `${rowBg}88` : rowBg, color: '#fff', borderRadius: '8px', whiteSpace: 'nowrap' }}>
                                            {isLocked ? '🔒 ' : ''}{color}
                                            <span className="row-score-badge">{markCount} = {rowPoints}pts</span>
                                        </th>
                                        {Array.from({ length: 11 }, (_, index) => index + 2).map(realIndex => {
                                            const visualIndex = LOW_TO_HIGH[color] ? realIndex : 14 - realIndex;
                                            const disabled = isLocked || !game.rolled || isUnavailable(game, session.playerId, color, realIndex) || gameOver;
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
