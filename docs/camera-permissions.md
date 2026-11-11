# Camera status

**The current replay version needs no camera permission.** It does not install or
call the native Presage SDK. Keep `readReceipt.helper.mode` set to `replay`;
selecting `live` currently produces an unsupported-mode error.

No camera setup is required for `npm run test:replay`, the editor-host test or the
manual replay walkthrough. Changing OS camera settings cannot enable an
unimplemented live adapter.

## Future live feasibility work

`scripts/spike/probe.mjs` is a separate hardware experiment described in `PLAN.md`,
outside normal activation and replay tests. It needs a separately installed SDK,
a supported native runtime, a Presage key, camera access and usable credits. The
current replay results do not establish a successful live run.

Before running it, confirm the current SDK/platform requirements, obtain
authorization for camera/credit use and review its output. The script currently
writes derived diagnostics to `scripts/spike/s0-summary.json`. Keep credentials
outside source, logs and command-line arguments.

A future live adapter must document the permissions it actually requests and
verify that stopping/hiding the panel releases the camera. Those are future
requirements, not behavior already delivered here.

For current startup or localhost issues, see [troubleshooting](troubleshooting.md).
