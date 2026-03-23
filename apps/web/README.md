# Whiting Games Web (Client-Only)

This app is a pure client React/Vite web app (no SSR).

It supports two backend modes selected via Vite env vars:

- `mock` (default): in-browser backend emulator for local UI and split-screen testing.
- `functions`: Firebase Functions adapter over HTTP endpoints.

## Environment

Copy `.env.example` to `.env.local` and set values as needed.

- `VITE_GAME_BACKEND=mock|functions`
- `VITE_FUNCTIONS_BASE_URL=<functions base url>`

## Scripts

- `pnpm --filter web run dev`
- `pnpm --filter web run test`
- `pnpm --filter web run build`

## Notes

- Split-screen works in both modes.
- In `functions` mode, actions go through HTTP endpoints and the client keeps a local cache so split-screen stays responsive in a single browser session.
