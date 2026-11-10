# Task D — Review panel webview

## Goal
Build the Review Panel UI that shows camera preview (or REPLAY card), pulse badge,
eyes-on indicator, calibration progress, unread list, and privacy line.
Wire it to `HelperConnection` + `ReceiptsView` from `contracts.ts`.

## Owns (only these paths)
- `packages/extension/src/panel/**`
- `packages/extension/webview/**`
- You may add `packages/extension/src/panel/index.ts` exporting `createReviewPanel`
  matching `CreateReviewPanel` in `packages/extension/src/contracts.ts`.

## Must match
`PLAN.md` §2.5 and contracts.ts. Allowed wording only ("eyes-on time",
"on screen while you were looking").

## Deliver
1. `createReviewPanel(ctx, helper, receipts): ReviewPanelApi`
   - Opens a webview panel titled "Read Receipt" in `ViewColumn.Beside`
   - `visible` tracks view state; fire `onDidChangeVisibility`
   - On show → `helper.send({ type: 'start' })` + enable preview
   - On hide >2s or dispose → `helper.send({ type: 'stop' })`
2. Webview UI (vanilla TS or minimal bundling; no React required):
   - Live JPEG preview from `onPreviewFrame` (object URL / img)
   - In replay / no frames: clear card **"REPLAY — camera off"**
   - Pulse badge: bpm + small waveform from `onPulseTrace`
   - Eyes-on light + plain-language reason from `pauseReasons`
   - Calibration progress ring while phase === 'calibrating'
   - Unread list from `receipts.unread` with click → `receipts.reveal(id)`
   - Buttons: Start / Stop / Recalibrate
   - Privacy line: "Video stays on this computer. Nothing is recorded."
3. Strict CSP with nonce; use VS Code CSS variables (light/dark/high-contrast).
4. Typed messages in `panel/messages.ts`.
5. Vitest + jsdom tests: message → DOM for every phase and each pause reason.

## Pause reason copy (user-facing)
| reason | message |
| --- | --- |
| calibrating | Look at the middle of your editor |
| no-face | No face in view |
| multiple-faces | Only one person in view, please |
| face-not-forward | Face the screen |
| looking-down | Eyes back on the editor |
| eyes-closed | Eyes open to keep counting |
| no-pulse-yet | Checking for a live viewer… |
| pulse-lost | Live signal lost — receipts paused |
| too-dark | Too dark |
| too-bright | Too bright |
| excessive-motion | Hold still |
| low-frame-rate | Camera too slow |
| credits-exhausted | Presage credits used up — receipts paused. Replay mode still works. |
| panel-hidden | Review panel hidden — camera off |
| auth-failed / network / camera-unavailable / sdk-error | Clear, actionable text |

## Do not
- Edit `packages/extension/src/extension.ts`, tracker, decorations, or helper client (Task C)
- Edit `contracts.ts`
- Call getUserMedia (webview camera is blocked)
- Claim attention, focus, comprehension, fatigue, stress, or medical meaning for pulse
