# pi-wrapped-module

Declarative Pi coding-agent setup packaged with `nix-wrapper-modules`.

## Run

```bash
nix run .#p
```

The default app exposes a `p` binary.

Available flake outputs:

- `.#p`: minimal wrapper package exposing only `bin/p`
- `.#pi-wrapped`: full wrapped Pi package

Use `.#p` when you want the wrapped launcher without colliding with another Pi
package that already provides `bin/pi`.

## State

Runtime state is isolated from normal Pi and stored at:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi-wrapped/default
```

The wrapper executable is named `p`. It sets:

- `PI_LAUNCHER_BIN` to the currently running wrapper binary; child Pi processes must reuse this exact launcher
- `PI_CODING_AGENT_DIR`
- `PI_PACKAGE_DIR`
- `PI_CODING_AGENT_SESSION_DIR`
- `PI_SKIP_VERSION_CHECK=1`
- `PI_TELEMETRY=0`

Each profile also gets its own generated `AGENTS.md` inside `PI_CODING_AGENT_DIR`, so profile-specific agent instructions follow the active wrapped launcher.

Each profile also gets a generated `APPEND_SYSTEM.md` inside `PI_CODING_AGENT_DIR` to append wrapper-specific response-style instructions without replacing Pi's default system prompt.

`settings.json` and `keybindings.json` are generated declaratively and
overwritten on every launch.

Consumers can also set these module options directly instead of overriding raw
settings content:

- `pi.defaultModel` -> generated `settings.json` `defaultProvider`/`defaultModel` (use a fully-qualified id like `openai-codex/gpt-5.5`)
- `pi.theme` -> generated `settings.json` `theme`
- `pi.appendSystemPrompt` -> extra Markdown appended after the wrapper default in profile-local `APPEND_SYSTEM.md`
- `pi.overrideSystemPrompt` -> replace profile-local `APPEND_SYSTEM.md` entirely
- `pi.splash.logoText` -> normal launch splash logo text
- `pi.splash.versionText` -> version suffix after the logo; set to `null` to hide
- `pi.splash.compactHelpText` -> compact normal launch splash help text
- `pi.splash.helpText` -> normal launch splash help text

Example theme override:

```nix
pi.theme = "gruvbox-dark-hard";
```

Example append:

```nix
pi.appendSystemPrompt = ''
  # Local rules

  Always mention exact Nix option names when relevant.
'';
```

Example override:

```nix
pi.overrideSystemPrompt = ''
  # Response style

  Answer in one sentence unless asked otherwise.
'';
```

Example splash override:

```nix
pi.splash = {
  logoText = ''
    ██████╗ ██╗
    ██╔══██╗██║
    ██████╔╝██║
    ██╔═══╝ ██║
    ██║     ██║
    ╚═╝     ╚═╝
  '';
  versionText = null;
  compactHelpText = "Press {expandKey} for help.";
  helpText = "Pi profile. Wrapped launcher only.";
};
```

Default keybindings add Emacs-style `ctrl+p`/`ctrl+n` movement for the editor
and selectors, unbind conflicting model/session/provider actions, and move the
named-session filter toggle to `ctrl+shift+n`.

## Packages

Pi package-loader entries can still be written declaratively with `pi.packages`, but the default profile keeps that list empty and loads Pi packages from Nix-built resource packages instead:

- `pi-fff` from <https://github.com/dmtrKovalenko/fff>
- `pi-dynamic-workflows` from <https://github.com/Michaelliv/pi-dynamic-workflows>

Pi does not need to run `pi install` for default resources.

## Resources

Repo-managed resources live in:

- `skills/`
- `prompts/`
- `themes/`
- `extensions/`

These paths are written into generated Pi settings. Vendored resources currently include:

- extensions: `split-fork`, `todos`, `multi-edit`, `context`, `clanker-working-messages`, `explore`, `tree-summary-model`

The Gondolin extension is bundled too, but it is only loaded when enabled declaratively:

```nix
pi.gondolin.enable = true;
```

`explore` and `tree-summary-model` now share cheap-model selection. Set:

- `PI_CHEAP_MODEL` for the primary cheap model
- `PI_CHEAP_FALLBACK_MODELS` for a comma-separated fallback list

Or configure them declaratively:

```nix
pi.cheapModels = {
  primary = "openai-codex/gpt-5.4-mini";
  fallbacks = [
    "github-copilot/gpt-5.4-mini"
    "anthropic/claude-haiku-4-5"
  ];
};
```

Feature-specific overrides still work:

- `PI_EXPLORE_MODEL`, `PI_EXPLORE_FALLBACK_MODELS`
- `PI_TREE_SUMMARY_MODEL`, `PI_TREE_SUMMARY_FALLBACK_MODELS`
- `PI_COMPACTION_MODEL`, `PI_COMPACTION_FALLBACK_MODELS`
- skills: `librarian`, `tmux`, `herdr`, `commit`, `github`
- themes: `gruvbox-dark-hard`

Nix-built Pi resource packages are also written into generated settings via `pi.resourcePackages`; the default profile exposes the `pi-fff` extension from `.#pi-fff` and the dynamic workflow extension from `.#pi-dynamic-workflows`.

Matt Pocock skills are available from a pinned upstream source via `pi.mattPocockSkills`. The default profile discovers and exposes all `skills/engineering/*` and `skills/in-progress/*` entries as manual-only skills by patching `disable-model-invocation: true` into their frontmatter. `skills/deprecated/*` and `skills/personal/*` are intentionally ignored by default.

You can choose exactly which skill directories to expose, for example:

```nix
pi.mattPocockSkills = {
  enable = true;
  skills = [
    "skills/engineering/tdd"
    "skills/engineering/diagnosing-bugs"
    "skills/productivity/grilling"
  ];
  hiddenSkills = [
    "skills/engineering/diagnosing-bugs"
  ];
};
```

`hiddenSkills` patches the packaged `SKILL.md` frontmatter with `disable-model-invocation: true`, so those skills stay available as `/skill:...` commands without being advertised for automatic model invocation.

Herdr's Pi integration is also loaded declaratively by default from a pinned
Herdr source checkout. It reports Pi session and agent state to Herdr when Pi is
running inside Herdr, and stays inactive elsewhere. Disable with:

```nix
pi.herdrIntegration.enable = false;
```

## Gondolin routing

Enable the bundled Gondolin routing extension declaratively:

```nix
pi.gondolin = {
  enable = true;
  imagePath = ./my-gondolin-image;
  guestMountPath = "/workspace";
};
```

When `pi.gondolin.enable = true`, the wrapper:

- loads the `gondolin` extension
- exports `PI_GONDOLIN_ENABLED=1`
- exports `PI_GONDOLIN_GUEST_MOUNT_PATH` from `pi.gondolin.guestMountPath`
- resolves the Gondolin image with this precedence:
  1. cwd-local `.#gondolin-image` flake output
  2. `GONDOLIN_IMAGE_PATH`
  3. `pi.gondolin.imagePath`
  4. Gondolin's built-in default image resolution

Runtime controls:

- `/gondolin on` -> route built-in `read`, `write`, `edit`, `bash`, `ls`, `find`, `grep` and user `!` commands into Gondolin
- `/gondolin off` -> use normal host execution
- `/gondolin status`
- `/gondolin toggle`

Environment variables:

- `PI_GONDOLIN_ENABLED=1` (or `PI_GONDOLIN=1`) starts with Gondolin routing enabled
- `PI_GONDOLIN_GUEST_MOUNT_PATH=/custom/path` changes the guest mount path from the default `/workspace`
- `GONDOLIN_IMAGE_PATH=/path/to/gondolin-assets` selects a guest image when the cwd flake does not expose `.#gondolin-image`

If `pi.gondolin.enable = false`, the extension is not loaded, so `/gondolin ...` commands are unavailable.

`pi-fff` stays on the host: `fffind`, `ffgrep`, and `fff-multi-grep` are not routed into Gondolin.

The bundled `librarian` skill includes a checkout helper. The wrapper adds it to `PATH` for Pi-launched shell commands as both:

- `checkout.sh`
- `pi-librarian-checkout`

Use either command from any working directory, for example:

```bash
checkout.sh https://github.com/dmtrKovalenko/fff --path-only
```

## Package source

Pi is provided by `github:numtide/llm-agents.nix` as `llm-agents.packages.${system}.pi`.

## Thanks

Thanks to Armin Ronacher for the Pi extensions and skills in <https://github.com/mitsuhiko/agent-stuff>.
