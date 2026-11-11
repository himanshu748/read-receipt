# Disposable review exercise

From the repository root, run:

```sh
node scripts/make-demo-repo.mjs
```

The script creates `fixtures/demo/_repo/` with a synthetic baseline commit under
the fictional identity `Read Receipt Demo Fixture <read-receipt-fixture@example.invalid>`.
It then leaves exactly six unstaged hunks across four files. The block at
`auth.js:40-58` contains `sk_live_DEMO_NOT_A_REAL_CREDENTIAL`, an obviously fake key
for the review exercise. No network requests or provider credits are involved.

Pass a different **new** directory as the first argument to create an isolated
exercise elsewhere. The script refuses an existing target and never removes it.
The default generated directory is gitignored.

Open the generated directory in the Extension Development Host, select replay mode,
and open the review panel. Save all files before tracking. Stage the changes and
install the Read Receipt hooks. A commit is blocked until all six hunks have earned
their receipts, or until you explicitly override that staged diff. Replay receipts
are identified as `replay viewer` in the commit trailer.
