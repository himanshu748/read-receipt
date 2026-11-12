# Camera setup

Replay needs no camera permission, key or provider credits. `npm ci` installs the
pinned SmartSpectra 3.5.0 dependency, but replay never initializes it or captures
frames. `npm run test:replay` and `npm run test:editor` remain camera-free.

## Live prerequisites

Use system Node.js 20 or newer, a supported native runtime, a camera and a Presage
key with usable allowance. The [SDK's documented platforms](https://smartspectra.presagetech.com/docs/nodejs/)
include Apple Silicon macOS, Windows x64 and Linux x64/arm64; Linux requires glibc
2.35 or newer. Intel macOS is not a supported target. A declared platform is not
proof that this project's complete workflow has been tested there.

Build and run from the source checkout:

```sh
npm ci
npm run build
```

The helper bundle loads the native SDK externally from `node_modules`. Retain
that dependency tree; copying the helper JavaScript alone is insufficient.
Installable VSIX/native packaging has not been validated.

## Start deliberately

1. Use **Read Receipt: Set Presage API Key** to store the key in SecretStorage.
   Do not put it in source, workspace settings, logs or command-line arguments.
2. Choose `live` for `readReceipt.helper.mode`. Choose the machine-level
   `readReceipt.helper.cameraIndex` (default `0`) for the intended camera.
3. Open the Review Panel. Read and accept its per-session disclosure. Declining
   starts no helper or camera. The editor session is capped at 90 seconds.
4. Grant camera permission if the operating system prompts. The SDK captures in
   the separate system-Node process; the displayed permission owner can depend
   on how that runtime/editor was launched.

On macOS, inspect **System Settings → Privacy & Security → Camera** if access is
denied. On Windows, check **Settings → Privacy & security → Camera**, including
desktop-app access. On Linux, check the selected camera device's availability and
your current user's device access. Do not change permissions broadly to work
around a missing native package, invalid key or provider network failure.

Keep another application from holding the camera exclusively. After granting
permission, reconnect through the extension and accept a new session only when
ready. There is no automatic provider retry.

## Observe and stop

The preview is encoded to JPEG in memory and sent only over authenticated
loopback. No video is saved by Read Receipt. Raw landmarks are reduced locally.
During calibration look at the editor; counting still requires usable face/eye
signals and live pulse/waveform input after calibration.

Stop or close the panel to release capture. Hiding it stops counting and preview
immediately and schedules camera stop after about two seconds. The 90-second
limit also ends capture. A new live session requires consent again.
The editor independently kills its owned helper at 90 seconds if the native
process hangs; explicit Stop has a three-second kill fallback. Live attachment
is not supported because an external process cannot be governed by that policy.

The SDK can transmit derived vitals to Presage/LLM services automatically despite
telemetry being disabled. SDK usage can consume existing credits. Review
[consent and data handling](consent.md) before starting. Passing replay checks
cannot verify the OS camera indicator or physical capture release; those require
an observed hardware run.
