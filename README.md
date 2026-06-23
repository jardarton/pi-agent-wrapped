# pi-wrapped-module

Declarative Pi coding-agent setup packaged with `nix-wrapper-modules`.

## Run

```bash
nix run .#pi
```

The default app exposes a `p` binary.

## State

Runtime state is isolated from normal Pi and stored at:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi-wrapped/default
```

The wrapper executable is named `p`. It sets:

- `PI_CODING_AGENT_DIR`
- `PI_PACKAGE_DIR`
- `PI_CODING_AGENT_SESSION_DIR`
- `PI_SKIP_VERSION_CHECK=1`
- `PI_TELEMETRY=0`

`settings.json` is generated declaratively and overwritten on every launch.

## Packages

Pi package-loader entries can still be written declaratively with `pi.packages`, but the default profile keeps that list empty and loads FFF from a Nix-built resource package instead:

- `pi-fff` from <https://github.com/dmtrKovalenko/fff>

Pi does not need to run `pi install` for default resources.

## Resources

Repo-managed resources live in:

- `skills/`
- `prompts/`
- `themes/`
- `extensions/`

These paths are written into generated Pi settings. Vendored resources currently include:

- extensions: `split-fork`, `todos`, `multi-edit`, `context`, `clanker-working-messages`
- skills: `librarian`, `tmux`, `commit`, `github`
- themes: `gruvbox-dark-hard`

Nix-built Pi resource packages are also written into generated settings via `pi.resourcePackages`; the default profile exposes the `pi-fff` extension from the `.#pi-fff` package.

Herdr's Pi integration is also loaded declaratively by default from a pinned
Herdr source checkout. It reports Pi session and agent state to Herdr when Pi is
running inside Herdr, and stays inactive elsewhere. Disable with:

```nix
pi.herdrIntegration.enable = false;
```

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
