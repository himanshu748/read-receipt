# Task A1 — Presage helper (replay)

## Goal
Ship a Node helper that replays recorded sessions over a localhost WebSocket and
computes `eyesOn` from derived features. No live SDK in this task (that's A2).

## Owns (only these paths)
- `packages/helper/**` (replace the stub)
- `fixtures/replay/**`

## Must match
`PLAN.md` §2.1, §2.2, §3 and `@rr/protocol` types. Import from `@rr/protocol`.

## Deliver
1. `src/features.ts` — landmarks → `{ pitch, yaw, eyeOpenness }` (ratios; MediaPipe
   indices 1, 10, 33, 133, 145, 152, 159, 263, 362, 374, 386). Raw landmarks never leave this file.
2. `src/eyesOn.ts` — pure `step(prev, input, cfg) -> next` state machine per PLAN §3
   (calibration, blink filter with closureMs, look-down z-score, pulse liveness, pause reasons).
3. `src/sources/replay.ts` — read `Recording`, emit samples on a clock (`--speed` optional).
4. `src/server.ts` — WS on `127.0.0.1` only; require `?token=`; reject any `Origin` header;
   emit `hello`, `state` @ 10 Hz, `phase`, `pulseTrace`, `error`. Handle `ClientToHelper`.
5. `src/recorder.ts` — append `RecordedSample`s to a JSON file (features/pulse/pressure/validation/error only).
6. `src/main.ts` — CLI: `rr-helper --mode replay --replay <file> [--loop] [--record <file>] --port 0 --token <hex>`
   Print one stdout line `{"type":"listening","port":N}` then serve.
7. `scripts/gen-replay.ts` (or `.mjs`) → `fixtures/replay/demo-session.json` with segments:
   calibrate 20s → reading → blink → 2s eye closure → looking down → no face → two faces → too dark → credits exhausted.
8. Unit tests: every pause reason; blink 0.9s vs 1.1s boundary; token/Origin rejection;
   replaying the fixture yields expected eyesOn timeline within ±100 ms.

## Acceptance
- `npm run build -w @rr/helper` succeeds
- Vitest tests under `packages/helper` pass
- No dependency on `@smartspectra/node-sdk` yet (A2 adds it)
- Wording: never claim attention/focus/comprehension/fatigue/stress

## Do not
- Edit files outside `packages/helper/**` and `fixtures/replay/**`
- Implement live camera / SmartSpectra
- Save video frames or raw landmarks to disk
