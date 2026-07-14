# Agent instructions

## Reference
<https://github.com/earendil-works/pi>
<https://github.com/BirdeeHub/nix-wrapper-modules>

## Pi-native child processes

`PI_LAUNCHER_BIN` is the authoritative identity of the currently active Pi wrapper. Pi-native features that fork, resume, or create a child of the active Pi session must reuse this exact launcher. This includes split/fork, explore, and similar extension-managed child sessions.

Do not resolve a profile name from `PATH` or fall back to `process.execPath` for these Pi-native descendants. If `PI_LAUNCHER_BIN` is unavailable, fail instead of guessing.

This invariant does not apply to root launchers, generic orchestrators, configured commands, arbitrary shell commands, or explicit profile selection. Those may run any command selected by their user or configuration.

`run-current-pi` is an optional convenience for manually re-executing the active wrapper.

Examples:

```sh
run-current-pi
run-current-pi --session /path/to/session.jsonl
herdr pane run "$PANE" "run-current-pi --session '/path/to/session.jsonl'"
```

## Generic vs personal layering

This repo has two layers; keep them separate:

- `module.nix` is the generic public wrapper module. All defaults must stay neutral: no personal models, themes, keybindings, skills, or third-party integrations enabled by default. New options belong here with off/empty defaults.
- `presets/personal.nix` carries the personal configuration, applied with `lib.mkDefault` so profiles and consumers can override it. Personal opinions go here, never into `module.nix` defaults.

Flake outputs follow the same split: `wrapperModules.pi` / `wrappers.pi` / `nixosModules.pi` / `homeModules.pi` are generic; the `personal` variants (and the `p*` packages/apps and profile home modules) build on the preset.

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
