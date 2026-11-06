# CineMoy — rules for Antigravity (agy)

This workspace is usually driven by Claude Code; agy takes over when Claude's quota runs out and does bulk work
Claude hands over. The global rules in `~/.gemini/GEMINI.md` apply too.

## Start of every session
1. Read the git sync message from the SessionStart hook. Anything **behind** → tell the user first.
2. If the project has a handoff/status doc, read its current-state section first.
3. To continue unfinished Claude work, use the `continue-from-claude` skill (`kit last claude`).

## Map
| Folder | Stack | Checks (run from that folder) |
|---|---|---|
| `.` | JavaScript (npm) | — |
| `android` | Android, Kotlin (Gradle) | `./gradlew assembleDebug` · `./gradlew lintDebug` · `./gradlew testDebugUnitTest` |

## Checks
Run the checks of the folder you changed (table above) before you report. Never claim a check passed unless
you ran it.

## Agents
`researcher` (flash, read-only) · `architect` (inherit, plans, no edits) · `coder` (flash, implements a plan).
Small or obvious changes: do them yourself, no subagent.
