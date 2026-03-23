import { Context, Effect, Data, Layer, Schema } from "effect"

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number
  readonly message: string
}> {}

export class HttpClient extends Context.Tag("HttpClient")<
  HttpClient,
  {
    readonly post: <A, I>(
      path: string,
      body: unknown,
      responseSchema: Schema.Schema<A, I>
    ) => Effect.Effect<A, HttpError>
  }
>() {}

export const FetchHttpClientLive = (baseUrl: string) =>
  Layer.succeed(HttpClient, {
    post: (path, body, responseSchema) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${baseUrl}${path}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
          catch: (e) => new HttpError({ status: 0, message: String(e) }),
        })
        if (!response.ok) {
          const text = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: () =>
              new HttpError({
                status: response.status,
                message: "Failed to read response",
              }),
          })
          return yield* Effect.fail(
            new HttpError({ status: response.status, message: text })
          )
        }
        const json = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () =>
            new HttpError({
              status: response.status,
              message: "Invalid JSON",
            }),
        })
        return yield* Schema.decodeUnknown(responseSchema)(json).pipe(
          Effect.mapError(
            (e) =>
              new HttpError({ status: 0, message: `Decode error: ${e}` })
          )
        )
      }),
  })
