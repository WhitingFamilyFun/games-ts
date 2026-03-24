import type {
    FlixxColor,
    FlixxGame,
    FlyloGame,
    FireworksGame,
    FireworksCard,
    FireworkColor,
    GlumGame,
    GlumPlayer,
    FaceCard,
    FaceValue,
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
    fireworksScore,
    isRoundOverFireworks,
    isRoundOverGlum,
    cardValue as glumCardValue,
} from '@games/game-engine';
import type { CardNum } from '@games/effect-schemas';
import { useAtomSet, useAtomValue } from '@effect-atom/atom-react';
import { useCallback, useEffect, useState, useMemo, useRef, type TouchEvent as ReactTouchEvent } from 'react';
import { splitScreenAtom } from './atoms/session.js';
import { useAuth } from './lib/useAuth.js';
import type { User } from 'firebase/auth';
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
import { useFirebaseRoom } from './lib/useFirebaseRoom.js';
import { StatsScreen } from './StatsScreen.js';
import { ref, set } from 'firebase/database';
import { database } from './lib/firebase.js';

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

/** Display a card number as its numeric value (e.g. "m2" -> "-2", "p5" -> "5", "z" -> "0") */
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

const isFirebaseMode = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GAME_BACKEND === 'functions';

function AppPane({ paneId, title, firebaseUser }: { paneId: string; title: string; firebaseUser?: User }) {
    const [localSession, setLocalSession] = usePaneSession(paneId);

    // In Firebase mode with a user, override playerId and playerName from the auth user
    const session: PaneSession = firebaseUser
        ? { playerId: firebaseUser.uid, playerName: firebaseUser.displayName ?? 'Player', code: localSession.code }
        : localSession;
    const setSession = firebaseUser
        ? (updater: (value: PaneSession) => PaneSession) => setLocalSession(current => {
            const updated = updater({ ...current, playerId: firebaseUser.uid, playerName: firebaseUser.displayName ?? 'Player' });
            // Only persist the code change; playerId/playerName come from auth
            return { ...current, code: updated.code };
        })
        : setLocalSession;
    const [mockRoom, setMockRoom] = useState<RoomSnapshot | null>(null);
    const [games, setGames] = useState<readonly GameInfo[]>([]);
    const [message, setMessage] = useState<string>('');
    const [joinCode, setJoinCode] = useState(session.code);
    const [loading, setLoading] = useState(false);

    // In Firebase mode, use real-time listeners; in mock mode, use polling
    const firebaseRoom = useFirebaseRoom(isFirebaseMode ? session.code : '');
    const room = isFirebaseMode ? firebaseRoom : mockRoom;
    const setRoom = isFirebaseMode ? (() => {}) : setMockRoom;

    // Error auto-dismiss timer
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup error timer on unmount
    useEffect(() => {
        return () => {
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        };
    }, []);

    // Action atoms in promise mode -- each returns a promise that resolves with the success value
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
            // silently ignore -- games list is informational
        }
    }, [doGetGames, session.playerId]);

    // Refresh room state from the backend (mock mode only)
    const refreshRoom = useCallback(async (code: string) => {
        if (isFirebaseMode) return; // Firebase mode uses real-time listeners
        if (!code) {
            setMockRoom(null);
            return;
        }
        try {
            const snapshot = await doGetRoom(code as GameCode);
            setMockRoom(snapshot);
        } catch {
            setMockRoom(null);
        }
    }, [doGetRoom]);

    // Fetch games and room on mount and when session changes
    useEffect(() => {
        void refreshGames();
    }, [refreshGames]);

    useEffect(() => {
        if (!isFirebaseMode) {
            void refreshRoom(session.code);
        }
    }, [session.code, refreshRoom]);

    // Poll room state every 500ms in mock mode (just a Ref read, basically free)
    useEffect(() => {
        if (isFirebaseMode) return; // Firebase mode uses real-time listeners
        if (!session.code) return;
        const interval = setInterval(() => {
            void refreshRoom(session.code);
        }, 500);
        return () => clearInterval(interval);
    }, [session.code, refreshRoom]);

    async function runAction(action: () => Promise<void>) {
        setLoading(true);
        try {
            setMessage('');
            // Clear any pending error timer
            if (errorTimerRef.current) {
                clearTimeout(errorTimerRef.current);
                errorTimerRef.current = null;
            }
            await action();
        } catch (error: unknown) {
            console.error('Action error:', error);
            const msg = error instanceof Error
                ? error.message
                : typeof error === 'object' && error !== null && '_tag' in error
                    ? `${(error as { _tag: string })._tag}: ${JSON.stringify(error)}`
                    : String(error);
            setMessage(msg || 'Something went wrong');
            // Auto-dismiss error after 4 seconds
            errorTimerRef.current = setTimeout(() => {
                setMessage('');
                errorTimerRef.current = null;
            }, 4000);
        } finally {
            setLoading(false);
        }
    }

    async function createGame(gameType: 'Flylo' | 'Flixx' | 'Fireworks' | 'Glum') {
        const config: GameConfig = {
            gameType,
            adminID: session.playerId as PlayerId,
            rounds: 1,
            minPlayers: gameType === 'Flixx' ? 1 : 2,
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
        setMockRoom(null);
    }

    return (
        <section className="pane">
            <header className="pane-header">
                <h2>{title}</h2>
                <div className="info-pill">ID {session.playerId.slice(0, 6)}</div>
            </header>
            <div className="pane-body">
                {!firebaseUser && (
                    <label className="stack">
                        <span className="muted">Display name</span>
                        <input
                            value={session.playerName}
                            onChange={event => setSession(current => ({ ...current, playerName: event.target.value }))}
                            placeholder="Player name"
                        />
                    </label>
                )}

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
                        loading={loading}
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
                        loading={loading}
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
                        loading={loading}
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
                        loading={loading}
                    />
                ) : room.state?.type === 'Fireworks' ? (
                    <FireworksView
                        lobby={room.lobby}
                        session={session}
                        game={room.state}
                        onLeave={() => runAction(leavePane)}
                        onAction={runAction}
                        onSendEvent={async (event: GameEvent) => {
                            const state = await doSendEvent({ playerId: session.playerId as PlayerId, code: room.lobby.code, event });
                            setRoom(prev => prev ? { ...prev, state } : prev);
                        }}
                        loading={loading}
                    />
                ) : room.state?.type === 'Glum' ? (
                    <GlumView
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
                        loading={loading}
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
    loading,
}: {
    games: readonly GameInfo[];
    joinCode: string;
    onJoinCodeChange: (value: string) => void;
    onCreate: (gameType: 'Flylo' | 'Flixx' | 'Fireworks' | 'Glum') => void;
    onJoin: () => void;
    onResume: (code: string) => void;
    loading: boolean;
}) {
    return (
        <>
            <div className="summary-panel">
                <h3>New Game</h3>
                <div className="game-cards">
                    <button className="game-card" onClick={() => onCreate('Flylo')} disabled={loading}>
                        <span className="game-card-icon">&#9824;</span>
                        <span className="game-card-info">
                            <span className="game-card-name">{loading ? 'Flylo...' : 'Flylo'}</span>
                            <span className="game-card-desc">Card game &middot; 2-6 players</span>
                        </span>
                    </button>
                    <button className="game-card" onClick={() => onCreate('Flixx')} disabled={loading}>
                        <span className="game-card-icon">&#9858;</span>
                        <span className="game-card-info">
                            <span className="game-card-name">{loading ? 'Flixx...' : 'Flixx'}</span>
                            <span className="game-card-desc">Dice game &middot; 2-6 players</span>
                        </span>
                    </button>
                    <button className="game-card" onClick={() => onCreate('Fireworks')} disabled={loading}>
                        <span className="game-card-icon">&#127878;</span>
                        <span className="game-card-info">
                            <span className="game-card-name">{loading ? 'Fireworks...' : 'Fireworks'}</span>
                            <span className="game-card-desc">Co-op card game &middot; 2-6 players</span>
                        </span>
                    </button>
                    <button className="game-card" onClick={() => onCreate('Glum')} disabled={loading}>
                        <span className="game-card-icon">&#127183;</span>
                        <span className="game-card-info">
                            <span className="game-card-name">{loading ? 'Glum...' : 'Glum'}</span>
                            <span className="game-card-desc">Card shedding &middot; 3-8 players</span>
                        </span>
                    </button>
                </div>
            </div>

            <div className="summary-panel">
                <h3>Join</h3>
                <div className="actions">
                    <input value={joinCode} onChange={event => onJoinCodeChange(event.target.value.toUpperCase())} maxLength={4} placeholder="Game code" />
                    <button onClick={onJoin} disabled={joinCode.trim().length !== 4 || loading}>{loading ? 'Joining...' : 'Join Game'}</button>
                </div>
            </div>

            <div className="summary-panel">
                <h3>My Games</h3>
                {games.length === 0 ? <p className="muted">No active games yet.</p> : null}
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
    loading,
}: {
    lobby: Lobby;
    session: PaneSession;
    onStart: () => void;
    onDelete: () => void;
    onLeave: () => void;
    loading: boolean;
}) {
    const isAdmin = lobby.config.adminID === session.playerId;
    const [copied, setCopied] = useState(false);

    function copyCode() {
        void navigator.clipboard.writeText(lobby.code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }

    return (
        <>
            <div className="summary-panel lobby-header-panel">
                <h3>{lobby.config.gameType} Lobby</h3>
                <div className="lobby-code-display">
                    <span className="lobby-code-text">{lobby.code}</span>
                    <button className="btn-secondary lobby-copy-btn" onClick={copyCode}>{copied ? 'Copied!' : 'Copy Code'}</button>
                </div>
                <div className="status-row">
                    <span className="info-pill">{lobby.players.length}/20 players</span>
                    <span className="lobby-waiting"><span className="pulse-dot" /> Waiting for players...</span>
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
                <button className="btn-danger" onClick={onLeave} disabled={loading}>{loading ? 'Leaving...' : 'Leave'}</button>
                <button onClick={onStart} disabled={!isAdmin || lobby.players.length < 2 || loading}>{loading ? 'Starting...' : 'Start Game'}</button>
                <button className="btn-danger" onClick={onDelete} disabled={!isAdmin || loading}>Delete Game</button>
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
    loading,
}: {
    lobby: Lobby;
    session: PaneSession;
    game: FlyloGame;
    onLeave: () => void;
    onAction: (action: () => Promise<void>) => Promise<void>;
    onSendEvent: (event: GameEvent) => Promise<void>;
    onNextRound: () => Promise<void>;
    loading: boolean;
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
                        disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !!ownPlayer?.card || !!ownPlayer?.discardToFlip || loading}
                    >?</button>
                </div>
                <div className="pile-group">
                    <span className="pile-label">{ownPlayer?.card ? 'Discard Here' : 'Discard'}</span>
                    {topDiscard ? (
                        <button
                            className={`flylo-card face-up pile-card ${flyloCardColorClass(topDiscard.number)}`}
                            onClick={() => {
                                if (ownPlayer?.card && !ownPlayer.fromDiscard) {
                                    // Holding a card drawn from deck -> discard it
                                    void sendEvent({ kind: 'discard' });
                                } else if (!ownPlayer?.card && !ownPlayer?.discardToFlip) {
                                    // No held card -> draw from discard
                                    void sendEvent({ kind: 'draw', fromDiscard: true });
                                }
                            }}
                            disabled={roundOver || !setupDone || currentPlayerId !== session.playerId || !!ownPlayer?.discardToFlip || (!!ownPlayer?.card && ownPlayer.fromDiscard) || loading}
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
                <button className="btn-secondary" onClick={() => void onAction(() => onNextRound())} disabled={!roundOver || gameOver || loading}>{loading ? 'Next Round...' : 'Next Round'}</button>
                <button className="btn-danger" onClick={onLeave} disabled={loading}>Leave</button>
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
                            <button onClick={() => void onAction(() => onNextRound())} disabled={loading}>Next Round</button>
                        ) : null}
                    </div>
                );
            })() : null}

            {/* Player hands -- swipeable carousel, starting with self */}
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
                                        disabled={roundOver || loading}
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
    loading,
}: {
    lobby: Lobby;
    session: PaneSession;
    game: FlixxGame;
    onLeave: () => void;
    onAction: (action: () => Promise<void>) => Promise<void>;
    onSendEvent: (event: GameEvent) => Promise<void>;
    loading: boolean;
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
                    <span className={`die die-white`}>{white1 ?? '-'}</span>
                    <span className="die-label">W2</span>
                    <span className={`die die-white`}>{white2 ?? '-'}</span>
                    {ALL_FLIXX_COLORS.map(color => (
                        <span key={color} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                            <span className="die-label">{color[0]?.toUpperCase()}</span>
                            <span className={`die die-${color}`}>{game.currentRoll?.coloredRolls[color]?.value ?? '-'}</span>
                        </span>
                    ))}
                </div>
            </div>

            <div className="actions">
                <button onClick={() => void sendEvent({ kind: 'roll' })} disabled={currentPlayer?.id !== session.playerId || game.rolled || gameOver || loading}>{loading ? 'Roll...' : 'Roll'}</button>
                <button className="btn-danger" onClick={() => void sendEvent({ kind: 'takePenalty' })} disabled={currentPlayer?.id !== session.playerId || !game.rolled || gameOver || loading}>Take Penalty</button>
                <button className="btn-secondary" onClick={() => void sendEvent({ kind: 'pass' })} disabled={!game.rolled || gameOver || loading}>Pass</button>
                <button className="btn-danger" onClick={onLeave} disabled={loading}>Leave</button>
            </div>

            {/* Flixx Game Over banner */}
            {gameOver ? (() => {
                const entries = lobby.players.map(player => {
                    const fp = game.flixxPlayers[player.id as PlayerId];
                    if (!fp) return null;
                    return { player, score: playerScore(fp), penalties: fp.card.numPenalties };
                }).filter(Boolean) as Array<{ player: Player; score: number; penalties: number }>;

                // Highest score wins in Flixx
                const sorted = [...entries].sort((a, b) => b.score - a.score);
                const winner = sorted[0];

                return (
                    <div className="round-over-banner game-over">
                        <h3>Game Over!</h3>
                        <div className="winner-callouts">
                            {winner && <span className="winner-callout">Winner: {winner.player.name} ({winner.score} pts)</span>}
                        </div>
                        <div className="round-scores">
                            {sorted.map((e, idx) => (
                                <div key={e.player.id} className={`round-score-entry${idx === 0 ? ' winner' : ''}`}>
                                    <span>{playerLabel(e.player, session)}</span>
                                    <span>Score: {e.score}</span>
                                    <span>Penalties: {e.penalties > 0 ? Array.from({ length: e.penalties }, () => 'X').join(' ') : 'None'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })() : null}

            <div className="scoreboard">
                {lobby.players.map(player => {
                    const flixxPlayer = game.flixxPlayers[player.id as PlayerId];
                    if (!flixxPlayer) {
                        return null;
                    }
                    const score = playerScore(flixxPlayer);
                    const penalties = flixxPlayer.card.numPenalties;
                    const isCurrent = player.id === currentPlayer?.id;
                    return (
                        <div key={player.id} className={`player-tile${player.id === session.playerId ? ' self' : ''}${isCurrent ? ' current' : ''}`}>
                            <h3>{playerLabel(player, session)}</h3>
                            <div className="flixx-score-line">
                                <span className="flixx-total-score">{score} pts</span>
                                {penalties > 0 && (
                                    <span className="flixx-penalties">
                                        {Array.from({ length: penalties }, (_, i) => (
                                            <span key={i} className="penalty-x">X</span>
                                        ))}
                                    </span>
                                )}
                                {penalties === 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>No penalties</span>}
                            </div>
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
                                            const disabled = isLocked || !game.rolled || isUnavailable(game, session.playerId, color, realIndex) || gameOver || loading;
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

// ---------------------------------------------------------------------------
// Fireworks helpers
// ---------------------------------------------------------------------------

const FIREWORK_COLORS: FireworkColor[] = ['red', 'green', 'blue', 'white', 'yellow'];

const FIREWORK_COLOR_CSS: Record<FireworkColor, string> = {
    red: '#c62828',
    green: '#2e7d32',
    blue: '#0288d1',
    white: '#bdbdbd',
    yellow: '#f9a825',
};

const FIREWORK_COLOR_TEXT: Record<FireworkColor, string> = {
    red: '#fff',
    green: '#fff',
    blue: '#fff',
    white: '#222',
    yellow: '#333',
};

function FireworksView({
    lobby,
    session,
    game,
    onLeave,
    onAction,
    onSendEvent,
    loading,
}: {
    lobby: Lobby;
    session: PaneSession;
    game: FireworksGame;
    onLeave: () => void;
    onAction: (action: () => Promise<void>) => Promise<void>;
    onSendEvent: (event: GameEvent) => Promise<void>;
    loading: boolean;
}) {
    const ownIndex = game.playerIds.indexOf(session.playerId as PlayerId);
    const roundOver = isRoundOverFireworks(game);
    const score = fireworksScore(game);
    const currentPlayerId = game.currentPlayerIndex >= 0 ? game.playerIds[game.currentPlayerIndex] ?? '' : '';
    const isMyTurn = currentPlayerId === session.playerId;
    const isHintPending = game.hintForPlayer !== null;
    const isHintForMe = game.hintForPlayer === session.playerId;

    // Hint UI state
    const [hintTarget, setHintTarget] = useState<PlayerId | ''>('');
    const [hintColor, setHintColor] = useState<FireworkColor>('red');
    const [hintNumber, setHintNumber] = useState<number>(1);

    function sendEvent(event: GameEvent) {
        return onAction(() => onSendEvent(event));
    }

    // Carousel for other players' hands (skip self)
    const otherPlayers = useMemo(() => {
        return lobby.players
            .map((p, i) => ({ player: p, index: i }))
            .filter(({ player }) => player.id !== session.playerId);
    }, [lobby.players, session.playerId]);

    const [carouselIdx, setCarouselIdx] = useState(0);
    const viewedIdx = otherPlayers.length > 0 ? carouselIdx % otherPlayers.length : 0;
    const viewed = otherPlayers[viewedIdx];

    // Swipe handling
    const touchStartX = useRef<number | null>(null);
    const handleTouchStart = (e: ReactTouchEvent) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
    const handleTouchEnd = (e: ReactTouchEvent) => {
        if (touchStartX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) setCarouselIdx(i => (i + 1) % Math.max(otherPlayers.length, 1));
        else setCarouselIdx(i => (i - 1 + Math.max(otherPlayers.length, 1)) % Math.max(otherPlayers.length, 1));
    };

    return (
        <>
            {/* Game info header */}
            <div className="summary-panel">
                <h3>Fireworks</h3>
                <div className="status-row">
                    <span className="info-pill">Code {lobby.code}</span>
                    <span className="info-pill">Score: {score}/25</span>
                    <span className="info-pill">Deck: {game.drawPile.cards.length}</span>
                </div>
                <div className="status-row" style={{ marginTop: '0.5rem' }}>
                    <span className="fw-clocks">{'O'.repeat(game.numClocks)}{'_'.repeat(8 - game.numClocks)} Clocks</span>
                    <span className="fw-fuses">{'*'.repeat(game.numFuses)}{'_'.repeat(3 - game.numFuses)} Fuses</span>
                </div>
            </div>

            {/* Fireworks display */}
            <div className="fw-display">
                {FIREWORK_COLORS.map(color => (
                    <div
                        key={color}
                        className="fw-column"
                        style={{ backgroundColor: FIREWORK_COLOR_CSS[color], color: FIREWORK_COLOR_TEXT[color] }}
                    >
                        <div className="fw-color-label">{color}</div>
                        <div className="fw-color-value">{game.fireworks[color] ?? 0}</div>
                    </div>
                ))}
            </div>

            {/* Turn / hint status */}
            <p className="help-text">
                {roundOver
                    ? (game.numFuses === 0 ? 'Boom! A fuse blew - game over!' : `Game over! Final score: ${score}/25`)
                    : isHintPending
                        ? (isHintForMe
                            ? `You received a hint! ${game.showColor ? `Color: ${game.showColor}` : ''}${game.showNumber ? `Number: ${game.showNumber}` : ''}`
                            : `Waiting for ${lobby.players.find(p => p.id === game.hintForPlayer)?.name ?? 'player'} to acknowledge hint...`)
                        : (isMyTurn
                            ? 'Your turn: Play, Discard, or give a Hint'
                            : `Waiting for ${lobby.players.find(p => p.id === currentPlayerId)?.name ?? 'unknown'}...`)
                }
            </p>

            {/* Actions */}
            <div className="actions">
                {isHintForMe && !roundOver ? (
                    <button onClick={() => void sendEvent({ kind: 'fw_sawHint' })} disabled={loading}>
                        Acknowledge Hint
                    </button>
                ) : null}
                <button className="btn-danger" onClick={onLeave} disabled={loading}>Leave</button>
            </div>

            {/* Hint UI - only when it's your turn and no hint pending */}
            {isMyTurn && !isHintPending && !roundOver ? (
                <div className="summary-panel">
                    <h3>Give a Hint</h3>
                    <div className="fw-hint-row">
                        <select
                            value={hintTarget}
                            onChange={e => setHintTarget(e.target.value as PlayerId)}
                            style={{ borderRadius: '12px', padding: '0.5rem', background: 'rgba(11,16,23,0.55)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)' }}
                        >
                            <option value="">Select player...</option>
                            {lobby.players.filter(p => p.id !== session.playerId).map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="fw-hint-row" style={{ marginTop: '0.5rem' }}>
                        <div className="actions">
                            {FIREWORK_COLORS.map(c => (
                                <button
                                    key={c}
                                    className={`btn-secondary fw-hint-color-btn${hintColor === c ? ' fw-hint-selected' : ''}`}
                                    style={{ backgroundColor: hintColor === c ? FIREWORK_COLOR_CSS[c] : undefined, color: hintColor === c ? FIREWORK_COLOR_TEXT[c] : undefined, padding: '0.4rem 0.7rem', minHeight: 'auto' }}
                                    onClick={() => setHintColor(c)}
                                >{c}</button>
                            ))}
                            <button
                                onClick={() => void sendEvent({ kind: 'fw_infoColor', color: hintColor, hintFor: hintTarget as PlayerId })}
                                disabled={!hintTarget || game.numClocks <= 0 || loading}
                            >Hint Color</button>
                        </div>
                    </div>
                    <div className="fw-hint-row" style={{ marginTop: '0.5rem' }}>
                        <div className="actions">
                            {[1, 2, 3, 4, 5].map(n => (
                                <button
                                    key={n}
                                    className={`btn-secondary${hintNumber === n ? ' fw-hint-selected' : ''}`}
                                    style={{ padding: '0.4rem 0.7rem', minHeight: 'auto', border: hintNumber === n ? '2px solid rgba(252,181,105,0.8)' : undefined }}
                                    onClick={() => setHintNumber(n)}
                                >{n}</button>
                            ))}
                            <button
                                onClick={() => void sendEvent({ kind: 'fw_infoNumber', number: hintNumber, hintFor: hintTarget as PlayerId })}
                                disabled={!hintTarget || game.numClocks <= 0 || loading}
                            >Hint Number</button>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Game over banner */}
            {roundOver ? (
                <div className="round-over-banner game-over">
                    <h3>{game.numFuses === 0 ? 'Explosion!' : 'Game Complete'}</h3>
                    <div className="round-scores">
                        <div className="round-score-entry">
                            <span>Final Score</span>
                            <span>{score} / 25</span>
                        </div>
                    </div>
                    {FIREWORK_COLORS.map(color => (
                        <span key={color} className="info-pill" style={{ margin: '0.2rem', backgroundColor: FIREWORK_COLOR_CSS[color], color: FIREWORK_COLOR_TEXT[color] }}>
                            {color}: {game.fireworks[color] ?? 0}
                        </span>
                    ))}
                </div>
            ) : null}

            {/* Your hand (card backs) */}
            {ownIndex >= 0 ? (
                <div className="card-panel player-tile self">
                    <div className="player-hand-header">
                        <h3>Your Hand (hidden from you)</h3>
                    </div>
                    <div className="fw-hand">
                        {game.fireworksPlayers[ownIndex]?.cards.map((_, cardIdx) => (
                            <div key={cardIdx} className="fw-card-back">
                                <div className="fw-card-back-label">?</div>
                                <div className="actions" style={{ gap: '0.3rem', marginTop: '0.3rem' }}>
                                    <button
                                        className="btn-secondary"
                                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', minHeight: 'auto' }}
                                        onClick={() => {
                                            const card = game.fireworksPlayers[ownIndex]?.cards[cardIdx];
                                            if (card) void sendEvent({ kind: 'fw_play', card });
                                        }}
                                        disabled={!isMyTurn || isHintPending || roundOver || loading}
                                    >Play</button>
                                    <button
                                        className="btn-secondary"
                                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', minHeight: 'auto' }}
                                        onClick={() => {
                                            const card = game.fireworksPlayers[ownIndex]?.cards[cardIdx];
                                            if (card) void sendEvent({ kind: 'fw_discard', card });
                                        }}
                                        disabled={!isMyTurn || isHintPending || roundOver || loading}
                                    >Discard</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Other players' hands (visible) */}
            {viewed ? (() => {
                const { player: viewedPlayer, index: viewedPlayerIdx } = viewed;
                const fwPlayer = game.fireworksPlayers[viewedPlayerIdx];
                if (!fwPlayer) return null;
                const isCurrent = viewedPlayer.id === currentPlayerId;
                const isHintTarget = viewedPlayer.id === game.hintForPlayer;
                return (
                    <div
                        className={`card-panel player-tile${isCurrent ? ' current' : ''} carousel-panel`}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        <div className="player-hand-header">
                            <div className="carousel-nav">
                                <button className="carousel-btn" onClick={() => setCarouselIdx(i => (i - 1 + otherPlayers.length) % otherPlayers.length)}>&larr;</button>
                                <h3>{viewedPlayer.name}{isCurrent ? ' (Turn)' : ''}</h3>
                                <button className="carousel-btn" onClick={() => setCarouselIdx(i => (i + 1) % otherPlayers.length)}>&rarr;</button>
                            </div>
                            <span className="muted">{fwPlayer.cards.length} cards</span>
                        </div>
                        <div className="carousel-dots">
                            {otherPlayers.map((_, i) => (
                                <button key={i} className={`dot${i === viewedIdx ? ' active' : ''}`} onClick={() => setCarouselIdx(i)} />
                            ))}
                        </div>
                        <div className="fw-hand">
                            {fwPlayer.cards.map((card, cardIdx) => {
                                const highlighted = isHintTarget && (
                                    (game.showColor !== null && card.color === game.showColor) ||
                                    (game.showNumber !== null && card.number === game.showNumber)
                                );
                                return (
                                    <div
                                        key={cardIdx}
                                        className={`fw-card-face${highlighted ? ' fw-card-highlighted' : ''}`}
                                        style={{ backgroundColor: FIREWORK_COLOR_CSS[card.color], color: FIREWORK_COLOR_TEXT[card.color] }}
                                    >
                                        <div className="fw-card-number">{card.number}</div>
                                        <div className="fw-card-color-label">{card.color}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })() : null}
        </>
    );
}

// ---------------------------------------------------------------------------
// Glum helpers
// ---------------------------------------------------------------------------

const FACE_VALUE_ORDER: FaceValue[] = [
    'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace',
];

const FACE_VALUE_DISPLAY: Record<FaceValue, string> = {
    ace: 'A', two: '2', three: '3', four: '4', five: '5', six: '6',
    seven: '7', eight: '8', nine: '9', ten: '10', jack: 'J', queen: 'Q', king: 'K',
};

const SUIT_SYMBOL: Record<string, string> = {
    clubs: '\u2663', spades: '\u2660', hearts: '\u2665', diamonds: '\u2666',
};

function glumCardDisplay(card: FaceCard): string {
    if (card.kind === 'joker') return '\uD83C\uDCCF';
    return `${SUIT_SYMBOL[card.suit] ?? '?'}${FACE_VALUE_DISPLAY[card.value] ?? '?'}`;
}

function glumCardIsRed(card: FaceCard): boolean {
    return card.kind === 'normal' && (card.suit === 'hearts' || card.suit === 'diamonds');
}

function sortGlumHand(cards: readonly FaceCard[]): FaceCard[] {
    return [...cards].sort((a, b) => glumCardValue(a) - glumCardValue(b));
}

function GlumView({
    lobby,
    session,
    game,
    onLeave,
    onAction,
    onSendEvent,
    onNextRound,
    loading,
}: {
    lobby: Lobby;
    session: PaneSession;
    game: GlumGame;
    onLeave: () => void;
    onAction: (action: () => Promise<void>) => Promise<void>;
    onSendEvent: (event: GameEvent) => Promise<void>;
    onNextRound: () => Promise<void>;
    loading: boolean;
}) {
    const ownIndex = game.playerIds.indexOf(session.playerId as PlayerId);
    const ownPlayer = ownIndex >= 0 ? game.glumPlayers[ownIndex] : null;
    const currentPlayerId = game.playerIds[game.currentPlayerIndex] ?? '';
    const isMyTurn = currentPlayerId === session.playerId;
    const roundOver = isRoundOverGlum(game);

    // Selected cards (indices into sorted hand)
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    const sortedHand = useMemo(() => ownPlayer ? sortGlumHand(ownPlayer.deck) : [], [ownPlayer?.deck]);

    function toggleCard(idx: number) {
        setSelectedIndices(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    }

    function sendEvent(event: GameEvent) {
        return onAction(() => onSendEvent(event));
    }

    function playSelectedCards() {
        if (selectedIndices.size === 0) return;
        const cards = Array.from(selectedIndices).map(i => sortedHand[i]!);
        setSelectedIndices(new Set());
        void sendEvent({ kind: 'glum_playSet', glumSet: { cards, declaredValue: null } });
    }

    // Top of pile
    const topSet = game.pile.sets.length > 0 ? game.pile.sets[game.pile.sets.length - 1]! : null;

    // Other players carousel
    const otherPlayers = useMemo(() => {
        return lobby.players
            .map((p, i) => ({ player: p, index: i }))
            .filter(({ player }) => player.id !== session.playerId);
    }, [lobby.players, session.playerId]);

    const [carouselIdx, setCarouselIdx] = useState(0);
    const viewedIdx = otherPlayers.length > 0 ? carouselIdx % otherPlayers.length : 0;
    const viewed = otherPlayers[viewedIdx];

    const touchStartX = useRef<number | null>(null);
    const handleTouchStart = (e: ReactTouchEvent) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
    const handleTouchEnd = (e: ReactTouchEvent) => {
        if (touchStartX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) setCarouselIdx(i => (i + 1) % Math.max(otherPlayers.length, 1));
        else setCarouselIdx(i => (i - 1 + Math.max(otherPlayers.length, 1)) % Math.max(otherPlayers.length, 1));
    };

    return (
        <>
            {/* Game info */}
            <div className="summary-panel">
                <h3>Glum</h3>
                <div className="status-row">
                    <span className="info-pill">Code {lobby.code}</span>
                    <span className="info-pill">Round {game.round}</span>
                    <span className="info-pill">Turn: {lobby.players.find(p => p.id === currentPlayerId)?.name ?? 'Unknown'}</span>
                </div>
            </div>

            {/* Pile display */}
            <div className="summary-panel">
                <h3>Pile {topSet ? `(${topSet.cards.length} card set)` : '(empty)'}</h3>
                {topSet ? (
                    <div className="glum-pile">
                        {topSet.cards.map((card, i) => (
                            <span key={i} className={`glum-card-display${glumCardIsRed(card) ? ' glum-red' : ' glum-black'}`}>
                                {glumCardDisplay(card)}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="muted">No cards played yet. Lead with any set.</p>
                )}
            </div>

            {/* Help text */}
            <p className="help-text">
                {roundOver
                    ? 'Round over!'
                    : isMyTurn
                        ? (topSet ? 'Select cards and Play, or Pass' : 'Select cards and Play (you must lead)')
                        : `Waiting for ${lobby.players.find(p => p.id === currentPlayerId)?.name ?? 'unknown'}...`
                }
            </p>

            {/* Actions */}
            <div className="actions">
                <button onClick={playSelectedCards} disabled={!isMyTurn || selectedIndices.size === 0 || roundOver || loading}>
                    Play {selectedIndices.size > 0 ? `(${selectedIndices.size})` : 'Cards'}
                </button>
                <button className="btn-secondary" onClick={() => void sendEvent({ kind: 'glum_pass' })} disabled={!isMyTurn || !topSet || roundOver || loading}>
                    Pass
                </button>
                <button className="btn-secondary" onClick={() => void onAction(() => onNextRound())} disabled={!roundOver || loading}>
                    Next Round
                </button>
                <button className="btn-danger" onClick={onLeave} disabled={loading}>Leave</button>
            </div>

            {/* Round over banner */}
            {roundOver ? (
                <div className="round-over-banner">
                    <h3>Round Over!</h3>
                    <div className="round-scores">
                        {lobby.players.map((player, pIdx) => {
                            const gp = game.glumPlayers[pIdx];
                            if (!gp) return null;
                            const isOut = game.outIndex.includes(pIdx);
                            const place = game.outIndex.indexOf(pIdx);
                            return (
                                <div key={player.id} className={`round-score-entry${place === 0 ? ' winner' : ''}`}>
                                    <span>{playerLabel(player, session)}</span>
                                    <span>{isOut ? `Out #${place + 1}` : `${gp.deck.length} cards left`}</span>
                                    <span>Total: {game.rewards[pIdx] ?? 0}</span>
                                </div>
                            );
                        })}
                    </div>
                    <button onClick={() => void onAction(() => onNextRound())} disabled={loading}>Next Round</button>
                </div>
            ) : null}

            {/* Your hand */}
            {ownPlayer ? (
                <div className="card-panel player-tile self">
                    <div className="player-hand-header">
                        <h3>Your Hand ({sortedHand.length} cards)</h3>
                        {ownPlayer.passed ? <span className="setup-status waiting">Passed</span> : null}
                    </div>
                    <div className="glum-hand">
                        {sortedHand.map((card, idx) => (
                            <button
                                key={idx}
                                className={`glum-card${selectedIndices.has(idx) ? ' glum-card-selected' : ''}${glumCardIsRed(card) ? ' glum-red' : ' glum-black'}`}
                                onClick={() => toggleCard(idx)}
                                disabled={roundOver}
                            >
                                {glumCardDisplay(card)}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Other players */}
            {viewed ? (() => {
                const { player: viewedPlayer, index: viewedPlayerIdx } = viewed;
                const glumPlayer = game.glumPlayers[viewedPlayerIdx];
                if (!glumPlayer) return null;
                const isCurrent = viewedPlayer.id === currentPlayerId;
                const isOut = game.outIndex.includes(viewedPlayerIdx);
                return (
                    <div
                        className={`card-panel player-tile${isCurrent ? ' current' : ''} carousel-panel`}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        <div className="player-hand-header">
                            <div className="carousel-nav">
                                <button className="carousel-btn" onClick={() => setCarouselIdx(i => (i - 1 + otherPlayers.length) % otherPlayers.length)}>&larr;</button>
                                <h3>{viewedPlayer.name}{isCurrent ? ' (Turn)' : ''}</h3>
                                <button className="carousel-btn" onClick={() => setCarouselIdx(i => (i + 1) % otherPlayers.length)}>&rarr;</button>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span className="muted">{glumPlayer.deck.length} cards</span>
                                {glumPlayer.passed ? <span className="setup-status waiting">Passed</span> : null}
                                {isOut ? <span className="setup-status ready">Out #{game.outIndex.indexOf(viewedPlayerIdx) + 1}</span> : null}
                            </div>
                        </div>
                        <div className="carousel-dots">
                            {otherPlayers.map((_, i) => (
                                <button key={i} className={`dot${i === viewedIdx ? ' active' : ''}`} onClick={() => setCarouselIdx(i)} />
                            ))}
                        </div>
                    </div>
                );
            })() : null}
        </>
    );
}

export function App() {
    const splitScreen = useAtomValue(splitScreenAtom);
    const setSplitScreen = useAtomSet(splitScreenAtom);
    const backendMode = isFirebaseMode ? 'firebase' : 'mock';
    const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
    const [showStats, setShowStats] = useState(false);

    // Write user email to RTDB on sign-in (needed for admin checks in stats)
    useEffect(() => {
        if (isFirebaseMode && user?.email) {
            void set(ref(database, `users/${user.uid}/email`), user.email);
        }
    }, [user?.uid, user?.email]);

    // In Firebase mode, gate on auth
    if (isFirebaseMode) {
        if (authLoading) {
            return (
                <main className="app-shell">
                    <div className="sign-in-screen">
                        <div className="sign-in-card">
                            <h1>Whiting Games</h1>
                            <div className="sign-in-spinner" />
                            <p className="muted">Checking sign-in status...</p>
                        </div>
                    </div>
                </main>
            );
        }

        if (!user) {
            return (
                <main className="app-shell">
                    <div className="sign-in-screen">
                        <div className="sign-in-card">
                            <h1>Whiting Games</h1>
                            <p className="muted">Sign in to play with friends</p>
                            <button className="google-sign-in-btn" onClick={() => void signInWithGoogle()}>
                                Sign in with Google
                            </button>
                        </div>
                    </div>
                </main>
            );
        }
    }

    return (
        <main className="app-shell">
            <div className="topbar">
                <div className="title-block">
                    <h1>Whiting Games</h1>
                </div>
                <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="mode-pill">{backendMode}</span>
                    {isFirebaseMode && user ? (
                        <>
                            <button className="btn-secondary" onClick={() => setShowStats(s => !s)}>
                                {showStats ? 'Play' : 'Stats'}
                            </button>
                            <div className="user-info">
                                {user.photoURL ? (
                                    <img className="user-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                                ) : null}
                                <span className="user-name">{user.displayName ?? 'Player'}</span>
                            </div>
                            <button className="btn-secondary" onClick={() => void signOut()}>Sign Out</button>
                        </>
                    ) : (
                        <button onClick={() => setSplitScreen(current => !current)}>{splitScreen ? 'Single Pane' : 'Split Screen'}</button>
                    )}
                </div>
            </div>

            {isFirebaseMode && user && showStats ? (
                <StatsScreen user={user} onBack={() => setShowStats(false)} />
            ) : (
                <div className={`pane-grid${splitScreen ? ' split' : ''}`}>
                    {isFirebaseMode && user ? (
                        <AppPane paneId="left" title="Pane A" firebaseUser={user} />
                    ) : (
                        <>
                            <AppPane paneId="left" title="Pane A" />
                            {splitScreen ? <AppPane paneId="right" title="Pane B" /> : null}
                        </>
                    )}
                </div>
            )}
        </main>
    );
}
