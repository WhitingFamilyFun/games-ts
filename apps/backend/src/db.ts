import { Context, Effect, Layer } from "effect"
import * as admin from "firebase-admin"

// Abstract database operations as an Effect service
export interface DatabaseApi {
  readonly get: (path: string) => Effect.Effect<unknown>
  readonly set: (path: string, value: unknown) => Effect.Effect<void>
  readonly remove: (path: string) => Effect.Effect<void>
}

export class Database extends Context.Tag("Database")<Database, DatabaseApi>() {}

export const FirebaseDatabaseLive = Layer.sync(Database, () => ({
  get: (path: string) =>
    Effect.promise(() =>
      admin
        .database()
        .ref(path)
        .get()
        .then((snap) => snap.val())
    ),
  set: (path: string, value: unknown) =>
    Effect.promise(() =>
      admin
        .database()
        .ref(path)
        .set(value)
        .then(() => undefined)
    ),
  remove: (path: string) =>
    Effect.promise(() =>
      admin
        .database()
        .ref(path)
        .remove()
        .then(() => undefined)
    ),
}))
