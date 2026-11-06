---
name: continue-from-claude
description: Use when the user asks to continue, resume or finish work that Claude Code started (for example "ادامه بده", "کارِ Claude را ادامه بده", "از جایی که مانده ادامه بده"), or when Claude hit its limit mid-task. Rebuilds the current state from the handoff docs, git and Claude's memory instead of exploring the repo from scratch.
---

# Continue Claude's work

Claude Code keeps the state of this workspace in files. Rebuild it from them, cheaply and in this order.
Stop reading as soon as you know the next step.

## 1. Sync first
Read the SessionStart git-sync message. If any repo is **behind**: stop and tell the user (pull first,
with `git pull --ff-only` or the project's `ws pull`). Work done on the other machine (Linux ↔ macOS)
only exists here after it was pushed there and pulled here.

## 2. Where Claude stopped
- `kit last claude` (run in the workspace root): the end of Claude's latest session here — the user's
  last requests, Claude's last replies, the files it edited. Usually this alone tells you the next step.
- The handoff named in the root `GEMINI.md` (status section only, not the whole file).
- `git log --oneline -10` in the repos that the handoff names, plus `git status` (uncommitted = work in progress; never discard it).
- `git worktree list` in those repos: a leftover worktree (`wt-*`) is half-done agent work; continue from its last commit.
- Claude's memory index for this workspace: `~/.claude/projects/<cwd with / replaced by ->/memory/MEMORY.md`.
  Memory is per machine and may be missing or older on this one.

## 3. Confirm before acting
Write the user a 3–5 line summary in Persian: what was finished, what is half-done, the next step you will take.
If the handoff already states the next step and the user's rules allow it, go ahead without asking.

## 4. Do the work
Follow the root `GEMINI.md` rules and the agents in `.agents/agents/` (researcher → architect only if hard → coder).

## 5. Leave a trail for Claude
When you stop, update the project's handoff/status file in place (the same file and style Claude uses, short),
so Claude can pick up from where you stopped. Commit only where the project's rules allow it.
