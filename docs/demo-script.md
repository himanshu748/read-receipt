# Demo script (≈ 2 minutes)

For hackathon judges. Uses the demo repo (6 hunks across 4 files) with a planted
fake key in `auth.js`. Prefer **replay** mode so credits are not spent.

## Prep (before the clock)

1. `npm install && npm run build`
2. Generate / open the demo repo (`scripts/make-demo-repo.mjs` once Task E lands).
3. `npx rr-hook install` in that demo repo.
4. Launch the extension (F5) with `readReceipt.helper.mode` = `replay` and the
   demo replay file set.
5. Confirm status bar shows something like `0/6 read` and gutters are grey ✓.

## Minute 0:00–0:20 — Show the unread state

1. Open the demo repo in the Extension Development Host.
2. Point at the **six grey ticks** in the gutter (unread / partial hunks).
3. Status bar: `$(check-all) 0/6 read` (or low count).

## Minute 0:20–0:50 — Review Panel + replay

1. Command: **Read Receipt: Open Review Panel** (opens beside the editor).
2. Panel shows **REPLAY — camera off**, eyes-on light, and the unread list.
3. Start / let replay run. Calibration segment plays first (nothing counts yet).

## Minute 0:50–1:20 — Ticks go blue

1. Scroll each hunk into view while replay reports eyes-on (or use
   **Next Unread Hunk**).
2. Watch gutters flip grey ✓ → blue ✓✓ as thresholds are met.
3. Status bar climbs toward `6/6 read`.

Leave the planted key unread on purpose for the next beat.

## Minute 1:20–1:45 — Commit blocked

1. Stage everything: `git add -A`.
2. `git commit -m "demo"` — **blocked**.
3. Hook output lists unread hunks; include **`auth.js` around lines 40–58** where
   the planted key lives:

   ```js
   const API_KEY = "sk_live_DEMO_…";
   ```

## Minute 1:45–2:00 — Read the key hunk, commit passes

1. Jump to that hunk (panel unread list or **Next Unread Hunk**).
2. Keep it on screen while you were looking until it earns ✓✓.
3. `git commit -m "demo"` again — **passes**.
4. Show the trailer:

   ```
   Read-Receipt: 6/6 hunks, … eyes-on, replay viewer
   ```

## Talking points (keep short)

- Blue ticks mean eyes-on time with the lines on screen while you were looking —
  not a claim about code correctness.
- Video stays on this computer; replay stores derived features only
  ([consent](consent.md)).
- Live mode needs a Presage key and a supported native platform; Intel Mac /
  Windows ARM stay on replay.
