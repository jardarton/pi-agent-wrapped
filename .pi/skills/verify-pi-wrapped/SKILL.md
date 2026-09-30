---
name: verify-pi-wrapped
description: Verify changes to this pi-agent-wrapped repository using automated checks and a fresh Pi TUI in a new Herdr tab. Use after modifying extensions, profiles, launchers, themes, skills, or other interactive Pi behavior.
---

# Verify pi-agent-wrapped changes

Verify behavior, not only compilation. Use a fresh Pi process in a separate Herdr tab when the change affects runtime or TUI behavior.

## Safety and launcher invariants

- First require `HERDR_ENV=1`. If unavailable, run non-interactive checks and report that interactive Herdr verification could not be performed.
- Require `PI_LAUNCHER_BIN` to be set. Fail instead of guessing.
- Spawn Pi only through the exact current `PI_LAUNCHER_BIN` value.
- Never invoke `pi`, `p`, `p-minimal`, `p-sandboxed`, a Nix-built candidate launcher, or another launcher name directly.
- Use the absolute `PI_LAUNCHER_BIN` path in Herdr commands.
- Never control or close the current focused pane. Parse current IDs from Herdr responses; do not guess IDs.

## 1. Identify the verification surface

Inspect:

```sh
git status --short
git diff --check
git diff --stat
git diff
```

Map each changed implementation file to its runtime entry point:

- `extensions/<name>.ts` -> load that file explicitly.
- `extensions/lib/...` -> load the top-level extension(s) importing that module.
- Shared launcher/module/profile/package changes -> run relevant Nix checks, but still spawn Pi only with the active launcher.
- Skill/theme changes -> use explicit `--skill` or `--theme` paths when practical.

Do not accidentally test an installed or Nix-store copy instead of the working-tree file.

## 2. Run deterministic checks first

For extension changes, run:

```sh
npm --prefix extensions run check
git diff --check
```

Run targeted tests for the changed subsystem when available. For Nix changes, prefer the narrowest relevant evaluation/build check, then `nix flake check` when warranted. Stop and fix deterministic failures before interactive testing.

## 3. Create an isolated Herdr test tab

Confirm the environment and discover the focused pane/workspace:

```sh
printf 'HERDR_ENV=%s\nPI_LAUNCHER_BIN=%s\n' "${HERDR_ENV-}" "${PI_LAUNCHER_BIN-}"
herdr pane list
```

Create a non-focused tab in the current workspace with a descriptive label:

```sh
herdr tab create --workspace <workspace-id> --label "verify <feature>" --no-focus
```

Read `result.root_pane.pane_id` and `result.tab.tab_id` from the returned JSON. Use those exact IDs in later calls.

## 4. Launch working-tree code

For extension verification, disable discovered extensions and explicitly load the changed working-tree entry points. This avoids collisions with packaged copies:

```sh
herdr pane run <new-pane-id> "cd <repo-root> && <absolute-PI_LAUNCHER_BIN> --no-extensions -e <repo-root>/extensions/<changed-entry>.ts"
```

Add one `-e` per entry point needed for the test. Include interacting changed extensions when the behavior crosses extension boundaries.

Use the authoritative absolute launcher path inside the new pane.

Wait for startup and inspect output:

```sh
herdr wait output <new-pane-id> --match "pi v" --timeout 30000
herdr pane read <new-pane-id> --source recent-unwrapped --lines 80
herdr pane read <new-pane-id> --source visible --ansi
```

Confirm the `[Extensions]` section names the intended working-tree extensions and no conflicting packaged copy is loaded.

## 5. Exercise the changed behavior

Drive the TUI as a user would:

```sh
herdr pane run <new-pane-id> "<command or prompt>"
herdr wait output <new-pane-id> --match "<expected text>" --timeout 60000
herdr pane read <new-pane-id> --source recent-unwrapped --lines 120
```

Use `--source visible --ansi` for placement, color, dimming, borders, wrapping, and other visual claims. Plain text output is insufficient for styling verification.

Test at least:

1. Startup/loading behavior.
2. The primary changed interaction.
3. One failure, disabled, or edge path when relevant.
4. Persistence versus transcript scrolling for UI placement changes.
5. Cleanup/shutdown if the change starts timers, processes, panes, or requests.

For asynchronous tools, wait for both launch and completion output. Read spawned panes when the tool itself creates Herdr splits.

## 6. Compare against the requirement

State concrete evidence:

- Checks run and pass/fail counts.
- Herdr tab and pane used.
- Exact working-tree files loaded.
- User actions sent.
- Relevant observed output and ANSI styling.
- Any behavior not verified and why.

Do not claim success from process startup alone.

## 7. Cleanup

If verification passes and the user did not ask to keep the test UI, close only the created test tab:

```sh
herdr tab close <new-tab-id>
```

On failure, leave the tab open when it contains useful debugging evidence and report its current ID. Remember that Herdr IDs can compact after closes; rediscover IDs before subsequent operations.
