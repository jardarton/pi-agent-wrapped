# pi-wrapped-module

Declarative Pi coding-agent setup packaged with `nix-wrapper-modules`.

## Run

```bash
nix run .#pi
```

The default app exposes a `pi` binary.

## State

Runtime state is isolated from normal Pi and stored at:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi-wrapped/default
```

The wrapper sets:

- `PI_CODING_AGENT_DIR`
- `PI_PACKAGE_DIR`
- `PI_CODING_AGENT_SESSION_DIR`
- `PI_SKIP_VERSION_CHECK=1`
- `PI_TELEMETRY=0`

`settings.json` is generated declaratively and overwritten on every launch.

## Packages

Declarative Pi packages are written into generated settings. The default profile includes:

- `npm:@ff-labs/pi-fff@0.6.0` from <https://github.com/dmtrKovalenko/fff>

Pi reconciles missing packages on startup after project trust; do not use `pi install` for the intended workflow.

## Resources

Repo-managed resources live in:

- `skills/`
- `prompts/`
- `themes/`
- `extensions/`

These paths are written into generated Pi settings.

The bundled `librarian` skill includes a checkout helper. The wrapper adds it to `PATH` for Pi-launched shell commands as both:

- `checkout.sh`
- `pi-librarian-checkout`

Use either command from any working directory, for example:

```bash
checkout.sh https://github.com/dmtrKovalenko/fff --path-only
```

## Package source

Pi is provided by `github:numtide/llm-agents.nix` as `llm-agents.packages.${system}.pi`.
