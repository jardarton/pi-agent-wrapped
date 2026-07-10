# Agent instructions

## Reference
<https://github.com/earendil-works/pi>
<https://github.com/BirdeeHub/nix-wrapper-modules>

## Pi launcher invariants

`PI_LAUNCHER_BIN` is the authoritative identity of the currently active Pi wrapper.

When spawning a new Pi process:

- always use `PI_LAUNCHER_BIN` or `run-current-pi`
- never invoke `pi`, `p`, `p-minimal`, `p-sandboxed`, or any other launcher name directly
- if `PI_LAUNCHER_BIN` is unset, fail instead of guessing

This applies to:

- extensions
- shell scripts
- Herdr/tmux/Ghostty spawned processes
- ad hoc agent actions requested in chat

## Manual and agent spawning

Prefer `run-current-pi` for manual or ad hoc agent-driven Pi spawns. It validates `PI_LAUNCHER_BIN` and execs the exact active wrapper.

Examples:

```sh
run-current-pi
run-current-pi --session /path/to/session.jsonl
herdr pane run "$PANE" "run-current-pi --session '/path/to/session.jsonl'"
```

## Pi profile packaging model

Profiles must be independently installable. Do not make an optional profile mutate or replace the default `p` wrapper; users may install many profile launchers side-by-side.

Keep consumer config simple. Put wrapper/buildEnv collision avoidance inside this repo, preferably behind `homeModules.<profile>` or `packages.<profile>` outputs.

Example consumer shape:

```nix
imports = [ inputs.pi-agent-wrapped.homeModules.camofoxBrowser ];

piProfiles.camofoxBrowser.enable = true;
```

Expected launch style:

```sh
p          # default profile
p-camofox  # Camofox profile
```
