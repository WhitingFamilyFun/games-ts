import { useState, useEffect } from "react"
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from "firebase/auth"
import { auth, googleProvider } from "./firebase.js"

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
  }, [])

  const signInWithGoogle = () => signInWithPopup(auth, googleProvider)
  const signOut = () => firebaseSignOut(auth)

  return { user, loading, signInWithGoogle, signOut }
}
