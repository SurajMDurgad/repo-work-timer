# Repo Work Timer

A VS Code status-bar timer for time spent running **Claude Code, Codex, and terminal commands** in a Git repository.

```text
◷ my-project · 2026-09 · 12h 35m
```

The timer sits on the right side of the status bar. It counts background runtime without checking window focus, keyboard input, or mouse activity. Two agents and a build running together still count as one elapsed interval.

## What counts

| Activity | Counted? |
|---|---|
| Claude Code or Codex working on a turn | Yes |
| A terminal command, build, test, or dev server running in the repo | Yes |
| Several agents or terminals running simultaneously | Once |
| An idle shell or agent waiting at its prompt | No |
| Editing or reading with no agent or command running | No |
| Computer asleep or extension host suspended | No |

**This measures tool runtime, not exact human attention.** A dev server left running counts until you stop it or pause the timer. VS Code and the extension host must remain running, although the window may be in the background.

## Getting started

1. Install a packaged VSIX with **Extensions → Install from VSIX…**.
2. Open a trusted Git repository. Subfolder and multi-root workspaces are supported; folders from the same Git root share a total.
3. Start Claude Code, Codex, or a terminal command. The timer updates every ten seconds.
4. Click the timer to pause/resume, inspect monthly totals, import earlier history, export CSV, or open the logs.

Each repository has its own total. In a workspace with several repositories, the status bar follows the active editor; **Choose repository** also lets you select one explicitly. Other open repositories continue to be tracked. Different worktree roots currently have separate totals.

New local calendar months start at zero automatically. Previous logs are retained, including when an interval crosses midnight on the last day of a month. Concurrent VS Code windows write separate files and merge overlapping time when calculating totals. Pause state is shared across windows on the same extension host's filesystem and propagates on the next poll.

## Monthly repository limits

Click the timer → **Set monthly limit**, or run **Repo Work Timer: Set Monthly Limit** to choose a repository. Enter hours (for example `20` or `1.5`); `0` removes the limit. Limits are optional, stored locally per Git root, shared across windows on the same extension host, and repeat each calendar month. Existing runtime, including imported history, counts toward the limit.

| Monthly usage | Timer appearance |
|---|---|
| Below 80% | Normal timer with used/limit hours and percentage |
| 80–94% | Yellow warning background, warning icon, → Approaching limit |
| 95–99% | Red error background, error icon, → Almost at limit |
| 100% and above | Red background, → Limit reached |

Only this extension's status item is highlighted. Tracking continues beyond the limit; pausing does not hide an existing limit warning. New months start with a fresh total and preserve historical records. Updates propagate on the next ten-second poll.

Run **Repo Work Timer: Preview Limit Colors** for both strips with synthetic example data in your current theme, or open [the browser demo](media/limit-preview.html). Icons and text accompany the colors for accessibility.

The design follows [VS Code's warning/error status item guidance](https://code.visualstudio.com/api/ux-guidelines/status-bar). The native API supports only `statusBarItem.warningBackground` and `statusBarItem.errorBackground`, so exact shades depend on your theme. To use the browser demo's balanced yellow and red palette, optionally add these entries to your existing **User Settings JSON** `workbench.colorCustomizations` object (these tokens affect all warning/error status items):

```json
"workbench.colorCustomizations": {
  "statusBarItem.warningBackground": "#D4AA32",
  "statusBarItem.warningForeground": "#171717",
  "statusBarItem.errorBackground": "#B64040",
  "statusBarItem.errorForeground": "#FFFFFF"
}
```

## Import earlier work

Run **Repo Work Timer: Import Agent History**, enter a month such as `2026-09`, and review the proposed additional time before importing. Imports reconstruct agent turn boundaries from the available local Claude Code and Codex transcripts. They are labeled as historical records, and repeated imports or overlaps with live tracking do not increase the same interval twice.

Missing or deleted transcripts cannot be recovered. Incomplete turns count only through their last recorded event. Historical terminal durations are not guessed from command timestamps: shell history usually does not preserve reliable start/end times or working directories.

## Compatibility and limitations

- Requires VS Code **1.96+** and Git available on the extension host.
- Agent detection reads `~/.codex/sessions` and `~/.claude/projects` by default and checks that a corresponding agent process exists. Custom homes and `CODEX_HOME` / `CLAUDE_CONFIG_DIR` are supported.
- VS Code terminals use [shell integration](https://code.visualstudio.com/docs/terminal/shell-integration). Enable shell integration if integrated terminal commands are not detected.
- macOS and Linux additionally discover existing/external terminal commands by their process working directory. Windows uses integrated terminal events; external Windows terminal processes are not tracked.
- Remote SSH, WSL, and container workspaces track activity on the **remote extension host**, using that host's logs and processes. They do not combine local desktop assistant sessions with remote sessions.
- Agent log formats are not stable public APIs. Unknown formats, wrapper processes with unrecognized names, and missing log events can cause undercounting. The Diagnostics output reports read/process errors.
- To prevent a crashed agent from counting forever, unfinished sessions expire after 30 minutes without a log update. Very quiet long agent runs can therefore undercount. This timeout is configurable; running terminal commands are independent of it.
- Live agent and external-terminal boundaries have roughly ten-second resolution. The final partial interval may be lost on a crash. A system clock change or heartbeat gap over 30 seconds is excluded.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `repoWorkTimer.enabled` | `true` | Enable tracking in this workspace |
| `repoWorkTimer.staleAgentMinutes` | `30` | Crash safeguard for silent unfinished agent sessions |
| `repoWorkTimer.codexHome` | Auto | Custom Codex data directory |
| `repoWorkTimer.claudeHome` | Auto | Custom Claude Code data directory |
| `repoWorkTimer.externalTerminals` | `true` | Detect external terminal commands on macOS/Linux |

## Data and privacy

There is no service account, telemetry, or network request in the extension runtime. It reads local agent transcripts in memory to recognize lifecycle events, and process names/working directories to identify running tools. It does **not** copy prompts, responses, terminal arguments, or source code into its logs.

Logs live under VS Code's extension global storage:

```text
SurajMDurgad.repo-work-timer/logs/<repository-hash>/
  repository.json
  2026-09/
    <window-session>.jsonl
    import-<interval-hash>.jsonl
```

`repository.json` stores the repository's local name and path. Each interval contains timestamps and source labels. **Open log folder** reveals the actual location on your system. Back up this directory to preserve your history; no remote backup is provided. CSV export contains per-day durations with overlapping activity merged.

Saved time survives restarts. On macOS, the original local timer's logs under `~/Library/Application Support/Repo Work Timer/<repository-name>/` are automatically migrated when the repository opens. Migration verifies the repository path, preserves every recorded month and the original files, and merges overlaps with current logs. Repeated starts do not duplicate time.

If migration fails, the timer shows **History recovery pending** and retries automatically while continuing to save current work. Open **Diagnostics** from the timer menu for the error. Ordinary updates use the same persistent storage; moving a repository, switching extension hosts, or deleting local storage is a separate change and is not covered by restart persistence.

## Development

```sh
npm ci
npm run check
npm test
npm run package
```

Open this project in VS Code and press **F5** to run an Extension Development Host. Tests use temporary directories and synthetic transcripts; no personal history is required. Runtime dependencies are zero; `@vscode/vsce` is a development-only packaging dependency.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow and [PUBLISHING.md](PUBLISHING.md) for Marketplace release steps. This project is independent of Microsoft, Anthropic, and OpenAI.
