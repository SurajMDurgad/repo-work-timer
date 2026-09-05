# Contributing

Create branches from `develop` and target `develop` for pull requests. Never target `main`.

Use Node 22 or later, then run `npm ci`, `npm run check`, `npm test`, and `npm run package`. Press F5 in VS Code to launch the extension in a development window. Open a disposable Git repository in that window for manual verification.

Test changes to lifecycle detection with synthetic Claude/Codex records. Cover interruptions, delayed tool results, missing completions, overlaps, repository boundaries, and monthly rollover. Do not add real user logs to fixtures or issue reports.

For UI verification, check right-side status placement, short terminal commands, persistent commands, pause/resume, multiple repositories, and a window left in the background. Verify that idle agent prompts and shells stop counting.
