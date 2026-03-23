import { Atom } from "@effect-atom/atom-react"

// Simple split-screen state atom (replaces Zustand store)
export const splitScreenAtom = Atom.make(false).pipe(Atom.keepAlive)
