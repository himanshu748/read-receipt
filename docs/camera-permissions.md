# Camera permissions

Live mode needs camera access for the Presage helper (a system Node process). The
Review Panel never opens the camera itself — webviews cannot — so the OS attributes
permission to the **parent editor** (VS Code or Cursor), or to Terminal if you start
the helper yourself.

## macOS

1. Open **System Settings › Privacy & Security › Camera**.
2. Enable **Code** and/or **Cursor** (whichever editor you use).
3. If you ran the helper from Terminal, also enable **Terminal** (or your shell app).
4. Quit and reopen the editor if the toggle was just flipped, then open the Review Panel.

## Windows

1. Open **Settings › Privacy & security › Camera**.
2. Turn on **Camera access**.
3. Turn on **Let desktop apps access your camera**.
4. Reopen VS Code / Cursor and open the Review Panel.

On Windows, prefer selecting a camera by ID (`--camera <id>`). Front/back enums can
fail with `kInputUnavailable`.

## Child process doesn't get the camera

macOS often grants the prompt to the parent app but the spawned Node child still
cannot open the device. Workaround:

1. Start the helper yourself in Terminal (so permission attaches to Terminal):

   ```bash
   export SMARTSPECTRA_API_KEY=...   # live mode only
   npx rr-helper --mode live --port 0 --token <32-byte-hex>
   ```

2. In the editor, set **`readReceipt.helper.attach`** to `true` (or run
   **Read Receipt: Open Review Panel** after configuring attach in settings).

3. The extension connects to the already-running helper instead of spawning one.

Replay mode needs no camera permission.

## Still stuck?

See [troubleshooting.md](troubleshooting.md) for `camera-unavailable` and related
pause reasons.
