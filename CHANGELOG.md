# Changelog

## 0.1.3

- Automatically migrate the original macOS timer's saved history without deleting original logs or double-counting overlaps.
- Show a persistent history-recovery warning and retry failed migrations while continuing to save current work.
- Add restart, crash, upgrade compatibility, and migration regression coverage and require history preservation checks before publishing.

## 0.1.2

- Add optional monthly runtime limits per repository, shared across local extension windows.
- Show usage percentages and status bar warnings at 80%, 95%, and 100% of the limit while continuing to track runtime.
- Add a limit color preview and document theme customization.

## 0.1.1

- Add a custom clock-and-Git-branch icon for the extension listing.

## 0.1.0

- Track monthly Git repository runtime for Claude Code, Codex, and terminal commands.
- Display totals on the right of the VS Code status bar, with pause/resume and repository selection.
- Retain monthly JSONL logs, merge overlaps, and exclude sleep gaps.
- Preview/import historical agent activity and export daily CSV totals.
- Support configurable agent homes and external terminal detection on macOS/Linux.
