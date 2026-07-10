---
name: delegate-with-herdr
description: Delegate independent finite noninteractive work to this user's configured one-shot Pi agents in visible Herdr tabs. Use when work benefits from an autonomous child or safe parallel read-only investigation.
compatibility: Requires Pi inside Herdr with pi-herdr-subagents and its subagent, subagent_status, and subagent_cancel tools.
metadata:
  generator: pi-herdr-subagents/setup-herdr-subagents
  schema-version: "1"
---

# Delegate with Herdr

Read [recipes](references/recipes.md), then choose one exact recipe.

- Write a self-contained prompt. No parent transcript or hidden context is transferred.
- Replace `<PROMPT>` only with the recipe's POSIX-safe quoted token. Never concatenate unquoted prompt text.
- Pass an explicit `cwd`. Set `timeoutMinutes` only for a real task-based wall-clock budget; omission means no deadline.
- Launch with `subagent({ name, command, cwd?, timeoutMinutes? })`.
- Rely on automatic result delivery. Continue only independent work while waiting.
- Use `subagent_status` once on demand. Never poll or infer progress from silence, terminal output, or Herdr sidebar state.
- Use `subagent_cancel` only with the exact run ID. Its response confirms a request, not process termination.
- Independent or read-only work may run concurrently. Serialize overlapping writers; no worktree isolation is provided.
- Reject commands needing a TTY, human input, a persistent daemon, inherited transcript, or orchestrator-controlled multi-turn interaction.

The orchestrator may add Pi `--model` and `--thinking` flags before `-p` only when their exact values are confirmed and task-appropriate. Do not infer model capability, cost, or availability.

Pi print mode writes its final response to stdout. The supervisor returns stdout's final 50 KiB. A future recipe may instead use `$SUBAGENT_RESULT_FILE`; valid nonempty content there takes precedence up to 50 KiB. Failures may include the final 8 KiB of stderr.

Commands run visibly in a child Herdr tab with the user's full authority.
