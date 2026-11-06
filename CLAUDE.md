# CineMoy

Set up by `kit add` (claude-code-toolkit). Facts for Claude; the toolkit's global rules apply too.

## Map
| Folder | Stack | Checks (run from that folder) |
|---|---|---|
| `.` | JavaScript (npm) | — |
| `android` | Android, Kotlin (Gradle) | `./gradlew assembleDebug` · `./gradlew lintDebug` · `./gradlew testDebugUnitTest` |

## Checks
Run the checks of the folder you changed (table above) before reporting; never claim a result you did not run.

## Agents
`.claude/agents/`: `researcher` (haiku, read-only) · `architect` (opus, plans) · `coder` (sonnet, implements).
agy has the same three in `.agents/agents/`. Stack checklists: the `kit-<stack>` skills (per machine, gitignored).
