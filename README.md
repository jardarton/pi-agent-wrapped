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
| `packages.<system>.p` | Neutral wrapped Pi launcher |
| `packages.<system>.pi-wrapped` | Full neutral wrapper package |
| `packages.<system>.pi` | Unwrapped source-built Pi package |

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
- `pi.splash.*`
- opt-in integrations under `pi.fff`, `pi.dynamicWorkflows`, `pi.goal`,
  `pi.herdrIntegration`, `pi.mattPocockSkills`, `pi.camofoxBrowser`,
  `pi.nixOptions`, `pi.betterOpenAI`, `pi.gondolin`, `pi.cheapModels`, and `pi.librarian`


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

Pi-native child processes must reuse the exact `PI_LAUNCHER_BIN`; they must fail
rather than guess another profile launcher.

Each profile receives generated `settings.json`, `keybindings.json`,
`AGENTS.md`, and `APPEND_SYSTEM.md` files on launch.

## Run the neutral package

```bash
nix run .#p
```
