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
      example = "openai-codex/gpt-6-luna";
      description = "Default Pi model. Use a fully-qualified provider/model id; generated settings split it into `defaultProvider` and `defaultModel` for Pi. When null, no default model is written and Pi's own selection applies.";
    };

    enabledModels = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [
        "openai-codex/gpt-6-luna"
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
  };
}
