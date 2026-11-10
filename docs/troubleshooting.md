# Troubleshooting

When eyes-on counting pauses, the Review Panel shows a plain-language reason. Below
is every `PauseReason` the helper can emit, plus what to do.

Counting only resumes when the condition clears (or you click **Retry** after an
error). Errors never auto-restart.

| Reason | What it means | What to do |
| --- | --- | --- |
| `not-started` | Helper connected but has not received `start` yet (panel not visible / not started). | Open the Review Panel and Start. |
| `calibrating` | First ~20 s of good face samples; nothing counts yet. Panel prompts you to look at the middle of the editor. | Face the screen until the calibration ring finishes. Use **Recalibrate** to restart. |
| `no-face` | No face in view (`kNoFaceFound`). | Sit in frame; check lighting and camera aim. |
| `multiple-faces` | More than one face (`kMultipleFacesFound`). Counting pauses because we cannot attribute reading. | One person in view only. |
| `face-not-forward` | Face not facing the camera (`kFaceNotForward`). | Turn toward the screen. |
| `looking-down` | Head pitch vs your calibration looks like looking at the keyboard. | Look at the editor; recalibrate if your seating changed. |
| `eyes-closed` | Eyes closed longer than `closureMs` (default 1 s). Short blinks are ignored. | Open your eyes; counting resumes when they reopen. |
| `no-pulse-yet` | Waiting for the first usable pulse (SDK ~12 s window). Shown as “Checking for a live viewer…”. | Keep facing the camera; overlaps calibration. |
| `pulse-lost` | Pulse / waveform dropped for longer than the hold window (~3 s). | Stay still and in frame; check lighting. A still photo never stays `live`. |
| `too-dark` | Scene too dark (`kTooDark`). | Add light; avoid backlight silhouettes. |
| `too-bright` | Scene too bright (`kTooBright`). | Reduce glare / direct light on the lens. |
| `excessive-motion` | Too much motion (`kExcessiveMotion`). | Hold still briefly. |
| `low-frame-rate` | Camera / pipeline frame rate too low (`kFrameRateTooLow`). | Close other camera apps; try another camera ID; Retry. |
| `camera-tuning` | SDK still tuning the camera (`kCameraTuning`). | Wait a moment; Retry if it sticks. |
| `face-position` | Face not centered, wrong size, too close/far, or too high/low. | Move so your face fills the guide; Retry. |
| `credits-exhausted` | Presage free credits used up (`kCreditExhausted`). SDK stops; receipts pause. | Switch `readReceipt.helper.mode` to **`replay`**. Replay still works without credits. |
| `auth-failed` | API key rejected (`kAuthenticationFailed`). | Re-run **Read Receipt: Set Presage API Key**; confirm `SMARTSPECTRA_API_KEY` if you start the helper in Terminal. |
| `network` | Key auth / SDK network error (`kNetworkError`). | Check connectivity; Retry. Replay mode needs no network. |
| `camera-unavailable` | No usable camera (`kInputUnavailable` or similar). | Grant camera permission ([camera-permissions.md](camera-permissions.md)); pick `--camera <id>` on Windows; or run helper from Terminal + `readReceipt.helper.attach`. |
| `sdk-error` | Other SmartSpectra error. | Read the panel message; Retry. Fall back to replay if live keeps failing. |
| `panel-hidden` | Review Panel hidden/closed; helper stopped the SDK on purpose. | Show the panel again to resume (camera stays off while hidden). |

## Credits exhausted (live mode)

When the SDK reports `kCreditExhausted`:

1. The helper maps it to **`credits-exhausted`**, stops the SDK, and forces eyes-on off.
2. The panel should say roughly: *Presage credits used up — receipts paused. Replay mode still works.*
3. Set **`readReceipt.helper.mode`** to `replay` (and a replay file) to keep demoing.
4. Live pulse will not return until credits are available again.

## Platform limits

- **Intel Mac / Windows ARM:** no native SmartSpectra binary — use **replay** only.
- **Node < 20:** upgrade system Node; point `readReceipt.nodePath` at it.
- Stale helper state (&gt; 750 ms) is treated as eyes-on off so a crashed helper cannot keep counting silently.

## Dirty editors & staging

- Unsaved (dirty) documents pause tracking for that file — save to resume.
- The hook checks the **staged** diff. Partial staging can leave unread hunks; stage what you intend to commit, or use `rr-hook override` / `READ_RECEIPT_OVERRIDE=1` knowingly.
