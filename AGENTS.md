# Development rules

- Branch from `develop` and target `develop` in every pull request. Never target `main`.
- Keep runtime dependencies at zero; run `npm run check`, `npm test`, and `npm run package` before a PR.
- Count elapsed agent/terminal runtime, not keyboard activity or window focus. Merge overlaps across sources and windows.
- Never commit real user transcripts, work logs, machine paths, or credentials. Tests use synthetic fixtures.
- Preserve historical records when months change, and make imports idempotent.
