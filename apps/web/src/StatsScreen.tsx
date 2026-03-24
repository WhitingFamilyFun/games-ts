/**
 * Stats & Leaderboard screen.
 * Shows personal stats for each game and global leaderboards.
 * Only available in Firebase mode when signed in.
 */
import { useState, useEffect, useCallback } from "react"
import type { User } from "firebase/auth"
import {
  claimStatsId,
  getStatsId,
  getUserStats,
  getLeaderboard,
  LEADERBOARD_STATS,
  type UserStats,
  type LeaderboardEntry,
  type LeaderboardStat,
} from "./lib/statsApi.js"

const STAT_LABELS: Record<string, string> = {
  flylo_wins: "Flylo Wins",
  flylo_games: "Flylo Games Played",
  flylo_rounds: "Flylo Rounds Played",
  flylo_lowest_round: "Flylo Lowest Round Score",
  flylo_highest_round: "Flylo Highest Round Score",
  flixx_wins: "Flixx Wins",
  flixx_highest_score: "Flixx Highest Score",
  flixx_games: "Flixx Games Played",
  fireworks_best_score: "Fireworks Best Score",
  fireworks_perfects: "Fireworks Perfect Games",
  fireworks_games: "Fireworks Games Played",
  glum_king_rounds: "Glum King Rounds",
  glum_games: "Glum Games Played",
}

const GAME_SECTIONS = [
  {
    name: "Flylo",
    stats: ["flylo_wins", "flylo_games", "flylo_rounds", "flylo_lowest_round", "flylo_highest_round"],
  },
  {
    name: "Flixx",
    stats: ["flixx_wins", "flixx_highest_score", "flixx_games"],
  },
  {
    name: "Fireworks",
    stats: ["fireworks_best_score", "fireworks_perfects", "fireworks_games"],
  },
  {
    name: "Glum",
    stats: ["glum_king_rounds", "glum_games"],
  },
]

export function StatsScreen({ user, onBack }: { user: User; onBack: () => void }) {
  const [statsId, setStatsId] = useState<string | null>(null)
  const [statsIdInput, setStatsIdInput] = useState("")
  const [statsIdError, setStatsIdError] = useState("")
  const [personalStats, setPersonalStats] = useState<UserStats>({})
  const [leaderboardData, setLeaderboardData] = useState<Record<string, LeaderboardEntry[]>>({})
  const [selectedLeaderboard, setSelectedLeaderboard] = useState<LeaderboardStat>("flylo_wins")
  const [loading, setLoading] = useState(true)
  const [claimingId, setClaimingId] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [id, stats] = await Promise.all([
        getStatsId(user.uid),
        getUserStats(user.uid),
      ])
      setStatsId(id)
      setPersonalStats(stats)

      // Load all leaderboards in parallel
      const lbResults = await Promise.all(
        LEADERBOARD_STATS.map(async (stat) => {
          const entries = await getLeaderboard(stat)
          return [stat, entries] as const
        })
      )
      setLeaderboardData(Object.fromEntries(lbResults))
    } catch (err) {
      console.error("Failed to load stats:", err)
    } finally {
      setLoading(false)
    }
  }, [user.uid])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function handleClaimStatsId() {
    const trimmed = statsIdInput.trim()
    if (!trimmed) return

    setClaimingId(true)
    setStatsIdError("")
    try {
      const result = await claimStatsId(user.uid, trimmed)
      if (result.error) {
        setStatsIdError(result.error)
      } else {
        setStatsId(result.statsId)
        setStatsIdInput("")
      }
    } catch (err) {
      setStatsIdError("Failed to claim stats ID")
    } finally {
      setClaimingId(false)
    }
  }

  if (loading) {
    return (
      <div className="stats-screen">
        <div className="stats-header">
          <button className="btn-secondary" onClick={onBack}>Back</button>
          <h2>Stats & Leaderboards</h2>
        </div>
        <p className="muted">Loading stats...</p>
      </div>
    )
  }

  return (
    <div className="stats-screen">
      <div className="stats-header">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <h2>Stats & Leaderboards</h2>
        <button className="btn-secondary" onClick={() => void loadData()}>Refresh</button>
      </div>

      {/* Stats ID section */}
      <div className="stats-id-section">
        {statsId ? (
          <p>Your Stats ID: <strong>{statsId}</strong></p>
        ) : (
          <div className="claim-stats-id">
            <p className="muted">Choose a public display name for leaderboards:</p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                value={statsIdInput}
                onChange={(e) => setStatsIdInput(e.target.value)}
                placeholder="e.g. coolplayer42"
                maxLength={30}
                style={{ flex: 1 }}
              />
              <button onClick={() => void handleClaimStatsId()} disabled={claimingId || !statsIdInput.trim()}>
                {claimingId ? "Claiming..." : "Claim"}
              </button>
            </div>
            {statsIdError && <p className="error-msg" style={{ color: "#e74c3c", marginTop: "0.25rem" }}>{statsIdError}</p>}
            <p className="muted" style={{ fontSize: "0.8rem" }}>3-30 characters, letters/numbers/underscores only</p>
          </div>
        )}
      </div>

      {/* Personal Stats */}
      <div className="personal-stats">
        <h3>Your Stats</h3>
        {GAME_SECTIONS.map((section) => {
          const hasSomeStats = section.stats.some((s) => (personalStats as any)[s] != null)
          if (!hasSomeStats) return null
          return (
            <div key={section.name} className="game-stats-section">
              <h4>{section.name}</h4>
              <div className="stats-grid">
                {section.stats.map((stat) => {
                  const value = (personalStats as any)[stat]
                  if (value == null) return null
                  return (
                    <div key={stat} className="stat-item">
                      <span className="stat-label">{STAT_LABELS[stat] ?? stat}</span>
                      <span className="stat-value">{value}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {Object.keys(personalStats).length === 0 && (
          <p className="muted">No stats yet. Play some games!</p>
        )}
      </div>

      {/* Leaderboards */}
      <div className="leaderboards">
        <h3>Leaderboards</h3>
        <div className="leaderboard-tabs">
          {LEADERBOARD_STATS.map((stat) => (
            <button
              key={stat}
              className={`leaderboard-tab${selectedLeaderboard === stat ? " active" : ""}`}
              onClick={() => setSelectedLeaderboard(stat)}
            >
              {STAT_LABELS[stat] ?? stat}
            </button>
          ))}
        </div>
        <div className="leaderboard-table">
          {(leaderboardData[selectedLeaderboard] ?? []).length === 0 ? (
            <p className="muted">No entries yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboardData[selectedLeaderboard] ?? []).map((entry, i) => (
                  <tr key={entry.uid} className={entry.uid === user.uid ? "highlight-row" : ""}>
                    <td>{i + 1}</td>
                    <td>{entry.statsId}</td>
                    <td>{entry.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
