![pi-agent-wrapped banner](assets/pi-agent-wrapped-banner.png)

# pi-agent-wrapped

Declarative [Pi](https://github.com/earendil-works/pi) coding-agent wrappers packaged with
[`nix-wrapper-modules`](https://github.com/BirdeeHub/nix-wrapper-modules).

This flake provides mechanisms, not personal agents:

- a neutral wrapper module with options for Pi settings and integrations
- the source-built Pi package and bundled resource packages
- `lib.mkProfile`, which builds an isolated launcher-only profile package
- a Home Manager module for declaring any number of downstream profiles

Concrete profiles, model choices, prompts, endpoints, and secrets belong in the
consumer's configuration. All defaults and default flake aliases are neutral.

## Outputs

| Output | Purpose |
| --- | --- |
| `wrapperModules.pi` / `wrapperModules.default` | Generic nix-wrapper-modules module |
| `wrappers.pi` / `wrappers.default` | Evaluated generic wrapper configuration |
| `lib.mkProfile` | Build one independently evaluated launcher-only profile package |
| `homeModules.pi` / `homeModules.default` | Generic Home Manager multi-profile module |
| `homeModules.wrapper` | Low-level single-wrapper install module |
| `nixosModules.pi` / `nixosModules.default` | Low-level generic wrapper install module |
| `darwinModules.*` | Alias of `nixosModules`; the install module dispatches on the target `_class` |
| `packages.<system>.p` | Neutral wrapped Pi launcher |
| `packages.<system>.pi-wrapped` | Full neutral wrapper package |
| `packages.<system>.pi` | Unwrapped source-built Pi package |
| `checks.<system>` | `extensions` (typecheck plus extension tests) and `launcher` (neutral wrapper build) |

`homeManagerModules` is an alias of `homeModules` for consumers that prefer the
conventional output name.

## Profile factory

`lib.mkProfile` accepts arbitrary wrapper modules and creates a package exposing
only the requested launcher names. The full wrapped package is available as the
result's `passthru.fullPackage`.

```nix
myPi = inputs.pi-agent-wrapped.lib.mkProfile {
  inherit pkgs;
  profileName = "openrouter";
  binName = "p-openrouter";
  aliases = [ ];
  modules = [
    ./pi/base.nix
    ./pi/openrouter.nix
  ];
};
```

A profile module uses the normal wrapper option schema:

```nix
# pi/openrouter.nix
{
  pi = {
    defaultModel = "openrouter/anthropic/claude-sonnet-4.5";
    enabledModels = [
      "openrouter/anthropic/claude-sonnet-4.5"
      "openrouter/google/gemini-2.5-pro"
    ];
    fff.enable = true;
  };
}
```

The factory forces `binName` and `pi.profileName` from its arguments so package
identity and mutable state isolation cannot accidentally diverge from the
consumer declaration.

## Home Manager profiles

Import the generic module and declare as many independently evaluated profiles
as needed:

```nix
{
  imports = [ inputs.pi-agent-wrapped.homeModules.pi ];

  programs.piWrapped = {
    enable = true;

    sharedModules = [
      ./pi/base.nix
    ];

    profiles = {
      main = {
        profileName = "default";
        binName = "p";
        aliases = [ "pi" ];
        modules = [ ./pi/main.nix ];
      };

      openrouter = {
        binName = "p-openrouter";
        modules = [ ./pi/openrouter.nix ];
      };

      browser = {
        binName = "p-browser";
        modules = [
          ./pi/browser.nix
          {
            pi.camofoxBrowser.apiKeyFile = config.sops.secrets.camofox.path;
          }
        ];
      };
    };
  };
}
```

Profile defaults:

- `profileName`: profile attribute name
- `binName`: `p-<profile attribute name>`
- `aliases`: empty
- `enable`: true
- `modules`: empty

`sharedModules` are evaluated before each profile's own modules. Modules use
`lib.types.deferredModule`, so the Home Manager interface does not duplicate or
drift from the wrapper's `pi.*` option schema.

Enabled profiles must have globally unique launcher names and mutable
`profileName` values.

## Direct generic wrapper use

Set options at wrap time:

```nix
inputs.pi-agent-wrapped.wrappers.pi.wrap {
  inherit pkgs;
  pi = {
    defaultModel = "anthropic/claude-sonnet-5";
    theme = "dark";
    localSkills = [ "commit" "github" ];
    bundledExtensions = [ "context" "multi-edit" ];
    fff.enable = true;
  };
}
```

Or extend the evaluated module yourself:

```nix
(inputs.pi-agent-wrapped.wrappers.pi.extendModules {
  modules = [ ./my-pi-profile.nix ];
}).config.wrap { inherit pkgs; }
```

## Selected wrapper options

All are optional; unset settings are omitted so Pi's own defaults apply.

- `pi.defaultModel`: fully-qualified `provider/model` identifier
- `pi.enabledModels`: model allowlist
- `pi.defaultThinkingLevel`: `off` through `xhigh`
- `pi.theme`, `pi.keybindings`, `pi.settings`
- `pi.projectTrust`: generated as `defaultProjectTrust`
- `pi.profileName`, `pi.stateRoot`: mutable state isolation
- `pi.localSkills`, `pi.bundledExtensions`
- `pi.resourcePackages`, `pi.packages`
- `pi.appendSystemPrompt`, `pi.overrideSystemPrompt`
- `pi.splash.enable` and `pi.splash.*` (see below)
- opt-in integrations under `pi.fff`, `pi.dynamicWorkflows`, `pi.goal`, `pi.review`,
  `pi.herdrIntegration`, `pi.mattPocockSkills`, `pi.camofoxBrowser`,
  `pi.nixOptions`, `pi.betterOpenAI`, `pi.gondolin`, `pi.cheapModels`, and `pi.librarian`

When `tree-summary-model` is listed in `pi.bundledExtensions`, its two overrides
can be controlled independently with `pi.cheapModels.treeSummary.enable` and
`pi.cheapModels.compaction.enable`. Both default to `true` for compatibility;
setting one to `false` leaves that operation to Pi's built-in implementation.

Enable Earendil's packaged code-review workflow with:

```nix
{
  pi.review.enable = true;
}
```

This exposes `/review` and `/end-review` and adds Git and GitHub CLI to the
wrapper. The integration is disabled by default.

When `pi.herdrIntegration.enable` is enabled, the wrapper also loads a narrowly
scoped terminal-capability shim. Herdr forwards Kitty graphics sequences while
presenting child PTYs as `TERM=xterm-256color`, which makes pi-tui disable inline
images. In a pane with `HERDR_ENV=1`, the shim enables only pi-tui's Kitty image
capability and preserves all other detected capabilities. It has no effect
outside Herdr. `terminal.showImages` must still be enabled for images to render.

### Camofox scoped snapshots

With `pi.camofoxBrowser.enable = true`, `camofox_snapshot` can return only an
accessibility subtree instead of spending model context on the whole page:

```json
{
  "tabId": "...",
  "scope": {
    "role": "region",
    "name": "More like this",
    "exact": true
  },
  "maxDepth": 4,
  "compact": true,
  "roles": ["article", "link"],
  "includeText": true,
  "includeUrls": true
}
```

`scope` accepts exactly one of `ref` or `role`; role scopes may also specify
`name`, `exact`, and a zero-based `occurrence`. Ambiguous role/name matches are
rejected unless `occurrence` is provided. The tool searches paginated source
snapshots automatically, preserves usable `eN` refs, and refuses to return a
subtree that Camofox split across a pagination boundary.

With `compact = true`, the tool emits structured items rather than snapshot
YAML. `roles` filters those items, while `includeText` and `includeUrls` control
whether descendant text and URL context is included.

CSS selector scopes are intentionally not exposed: Camofox currently returns
only a whole-page accessibility snapshot, and correlating arbitrary DOM
selectors with that tree client-side can select the wrong element. Reliable CSS
scoping requires server-side support in Camofox.

### Better OpenAI image tool

When `better-openai` is included in `pi.bundledExtensions`, its `/openai-image`
command remains available normally. Enable the agent-callable `openai_image`
tool separately:

```nix
{
  pi.betterOpenAI.imageTool.enable = true;
}
```

The tool supports generation and editing with up to five reference image paths
inside the current workspace. It is disabled by default without affecting fast
mode, usage reporting, settings, or the command.

### Launch splash

`pi.splash.enable` replaces Pi's launch splash with the `pi.splash.*` text. It is
off by default:

```nix
{
  pi.splash.enable = true;
  pi.splash.helpText = "Ask me anything.";
}
```

The substitution rewrites Pi's built JavaScript by matching literal upstream
source strings, and it has to happen inside the Pi derivation rather than in the
wrapper output — the launcher execs `${pi}/bin/pi`, and Node resolves modules from
that script's realpath, so a patched copy in the wrapper is never loaded. Two
consequences: an upstream edit to any of the matched strings becomes a hard build
failure, and enabling this builds a second Pi from source alongside the plain
`.#pi` package. With it disabled the wrapper's Pi and `.#pi` are the same
derivation.

### Nix option lookup

Enable `pi.nixOptions.enable` to expose the `nix_options` tool and add Nix to the
wrapper runtime. It is disabled by default. The tool discovers common flake
configuration outputs and searches or inspects their evaluated module option
metadata without evaluating final option values.

```nix
{
  pi.nixOptions.enable = true;
}
```

Supported output roots are `nixosConfigurations`, `homeConfigurations`,
`darwinConfigurations`, and `nixOnDroidConfigurations`. A full output path can
also be supplied for another configuration output that exposes an `options`
attribute.

## Runtime state and launcher identity

Each profile stores mutable state under:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi-wrapped/<profileName>
```

The launcher sets:

- `PI_LAUNCHER_BIN` to the canonical immutable path of the active wrapper
- `PI_CODING_AGENT_DIR`
- `PI_PACKAGE_DIR`
- `PI_CODING_AGENT_SESSION_DIR`
- `PI_SKIP_VERSION_CHECK=1`
- `PI_TELEMETRY=0`

The last two are `envDefault`, so an existing value in the environment wins. Set them
through `env` instead if a profile needs them pinned regardless of the caller.

Pi-native child processes must reuse the exact `PI_LAUNCHER_BIN`; they must fail
rather than guess another profile launcher.

Each profile receives generated `settings.json`, `keybindings.json`,
`AGENTS.md`, and `APPEND_SYSTEM.md` files on launch.

## Run the neutral package

```bash
nix run .#p
```
