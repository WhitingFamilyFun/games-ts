import { useState, useEffect } from "react"
import { ref, onValue } from "firebase/database"
import { database } from "./firebase.js"
import { Schema } from "effect"
import { GameState, Lobby } from "@games/effect-schemas"
import type { RoomSnapshot } from "@games/game-services"

export function useFirebaseRoom(code: string): RoomSnapshot | null {
  const [room, setRoom] = useState<RoomSnapshot | null>(null)

  useEffect(() => {
    if (!code) {
      setRoom(null)
      return
    }

    let currentLobby: RoomSnapshot["lobby"] | null = null
    let currentState: RoomSnapshot["state"] = null

    const unsubLobby = onValue(ref(database, `games/${code}/lobby`), (snap) => {
      const val = snap.val()
      currentLobby = val ? Schema.decodeUnknownSync(Lobby)(val) : null
      if (currentLobby) {
        setRoom({ lobby: currentLobby, state: currentState })
      } else {
        setRoom(null)
      }
    })

    const unsubState = onValue(ref(database, `games/${code}/state`), (snap) => {
      const val = snap.val()
      try {
        currentState = val ? Schema.decodeUnknownSync(GameState)(val) : null
      } catch {
        currentState = null
      }
      if (currentLobby) {
        setRoom({ lobby: currentLobby, state: currentState })
      }
    })

    return () => {
      unsubLobby()
      unsubState()
    }
  }, [code])

  return room
}
