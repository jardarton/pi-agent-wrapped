context:
{
  config,
  lib,
  ...
}:
let
  inherit (context) jsonFmtType;
in
{
  options.pi = {
    profileName = lib.mkOption {
      type = lib.types.strMatching "[A-Za-z0-9][A-Za-z0-9._-]*";
      default = "default";
      description = "Name used for the isolated mutable Pi profile directory.";
    };

    stateRoot = lib.mkOption {
      type = lib.types.str;
      default = "\${XDG_STATE_HOME:-$HOME/.local/state}/pi-wrapped";
      description = "Shell expression for the root directory containing Pi wrapper profiles.";
    };

    packages = lib.mkOption {
      type = lib.types.listOf jsonFmtType;
      default = [ ];
      description = "Declarative Pi packages written to generated settings.json for Pi's package loader.";
    };

    defaultModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "openai-codex/gpt-5.6-terra";
      description = "Default Pi model. Use a fully-qualified provider/model id; generated settings split it into `defaultProvider` and `defaultModel` for Pi. When null, no default model is written and Pi's own selection applies.";
    };

    enabledModels = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [
        "openai-codex/gpt-5.6-terra"
        "anthropic/claude-haiku-4-5"
      ];
      description = "Model allowlist written to generated settings.json as `enabledModels`. An empty list omits the key, leaving all models available.";
    };

    defaultThinkingLevel = lib.mkOption {
      type = lib.types.nullOr (
        lib.types.enum [
          "off"
          "minimal"
          "low"
          "medium"
          "high"
          "xhigh"
        ]
      );
      default = null;
      description = "Default reasoning effort written to generated settings.json. When null, the key is omitted and Pi's own default applies.";
    };

    projectTrust = lib.mkOption {
      type = lib.types.str;
      default = "ask";
      description = "Value written to generated settings.json as `defaultProjectTrust`.";
    };

    theme = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "gruvbox-dark-hard";
      description = "Pi theme written to generated settings.json as `theme`. When null, the key is omitted and Pi's own default applies.";
    };

    settings = lib.mkOption {
      type = jsonFmtType;
      default = { };
      apply =
        settings:
        let
          reserved = [
            "defaultModel"
            "defaultProvider"
            "defaultProjectTrust"
            "defaultThinkingLevel"
            "enabledModels"
            "enableInstallTelemetry"
            "extensions"
            "packages"
            "prompts"
            "skills"
            "theme"
            "themes"
          ];
          conflicts = builtins.filter (name: builtins.hasAttr name settings) reserved;
        in
        if conflicts == [ ] then
          settings
        else
          throw "pi.settings contains reserved generated keys: ${lib.concatStringsSep ", " conflicts}";
      description = ''
        Extra declarative Pi settings merged into generated settings.json. Generated
        model, security, and resource keys are reserved; configure those through their
        dedicated pi options.

        The generated `settings.json` is copied into the profile directory on every
        launch, so hand-edits to that file are discarded.
      '';
    };

    keybindings = lib.mkOption {
      type = jsonFmtType;
      default = { };
      example = {
        "tui.editor.cursorUp" = [
          "up"
          "ctrl+p"
        ];
      };
      description = ''
        Declarative Pi keybindings written to generated keybindings.json.

        Copied into the profile directory on every launch, so hand-edits to that file
        are discarded.
      '';
    };

    appendSystemPrompt = lib.mkOption {
      type = lib.types.lines;
      default = "";
      description = ''
        Markdown written to profile-local `APPEND_SYSTEM.md` under `PI_CODING_AGENT_DIR`.

        Copied into the profile directory on every launch, so hand-edits to that file
        are discarded. The same applies to the generated `AGENTS.md`.
      '';
    };

    overrideSystemPrompt = lib.mkOption {
      type = lib.types.nullOr lib.types.lines;
      default = null;
      description = "When set, replaces `pi.appendSystemPrompt` in profile-local `APPEND_SYSTEM.md` under `PI_CODING_AGENT_DIR`.";
    };

    splash = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether to replace Pi's launch splash with the `pi.splash.*` text below.

          Off by default for two reasons. It rewrites Pi's built JavaScript by
          matching literal upstream source strings, so an upstream edit to any of
          them turns into a hard build failure; leaving it off keeps that risk
          opt-in. It also has to be applied inside the Pi derivation, so enabling
          it builds a second Pi from source alongside the plain `.#pi` package.
        '';
      };

      logoText = lib.mkOption {
        type = lib.types.str;
        default = ''
          ██████╗ ██╗
          ██╔══██╗██║
          ██████╔╝██║
          ██╔═══╝ ██║
          ██║     ██║
          ╚═╝     ╚═╝
        '';
        description = "Logo text used in Pi's normal launch splash header.";
      };

      versionText = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = " v{version}";
        description = "Version suffix used after `pi.splash.logoText`. Set to null to hide it. `{version}` is replaced with Pi's runtime version.";
      };

      compactHelpText = lib.mkOption {
        type = lib.types.str;
        default = "Press {expandKey} to show full startup help and loaded resources.";
        description = "Compact normal launch splash help text. `{expandKey}` is replaced with the configured expand-tools key.";
      };

      helpText = lib.mkOption {
        type = lib.types.str;
        default = "Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.";
        description = "Normal launch splash help text shown below the startup key hints.";
      };
    };
  };
}
