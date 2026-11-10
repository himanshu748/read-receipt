# Task F — README + docs

## Goal
Document setup, consent/privacy, camera permissions, troubleshooting, and a
2-minute demo script for the hackathon judges.

## Owns (only these paths)
- `README.md` (create at repo root)
- `docs/**`

## Must include
1. **README.md**
   - What Read Receipt is (one paragraph, allowed wording only)
   - Architecture diagram (text is fine)
   - Requirements: Node ≥ 20, Apple Silicon Mac or Windows x64 or Linux,
     VS Code/Cursor, Presage API key from physiology.presagetech.com
   - Install & build (`npm install`, `npm run build`)
   - Extension: how to run (`F5` / vsce package path once Task C lands)
   - Helper modes: replay (default) vs live; set API key via command
   - Git hooks: `npx rr-hook install`
   - Demo: point to `docs/demo-script.md`
   - Link to Consent & Data Handling
2. **docs/consent.md** — Consent and Data Handling
   - Camera preview always visible while running; no hidden mode
   - No video saved or sent; store only local counts/timings under `.git/read-receipt/`
   - Optional recordings = derived features + pulse only
   - `enableTelemetry: false`; network only for Presage key auth
   - Pulse is a liveness signal, not a medical measurement (SDK wellness disclaimer)
   - Allowed vs banned claims
3. **docs/camera-permissions.md**
   - macOS: System Settings › Privacy & Security › Camera › enable Code / Cursor
   - Windows: Settings › Privacy & security › Camera › Let desktop apps access your camera
   - If the child Node process doesn't get the camera: run helper from Terminal;
     use `readReceipt.helper.attach`
4. **docs/demo-script.md** — 2-minute script
   - Open demo repo → show 6 grey ticks → open Review Panel → replay →
     watch ticks go blue → try commit (blocked on auth.js planted key) →
     "read" that hunk → commit passes with trailer
5. **docs/troubleshooting.md** — one entry per pause reason + credits exhausted

## Wording rules
Allowed: "eyes-on time", "on screen while you were looking".
Banned: attention, focus (as a measured claim), comprehension, fatigue, stress,
code correctness, medical claims, team/manager view, covert monitoring.

## Do not
- Edit packages or PLAN.md
- Invent setup steps that contradict PLAN.md
- Promise features not in the plan (no team dashboard, etc.)
