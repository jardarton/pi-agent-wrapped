inputs:
{
  config,
  lib,
  pkgs,
  wlib,
  ...
}:
let
  jsonFmtType = wlib.types.structuredValueWith { typeName = "JSON"; };
  resourceDirs = {
    skills = ./skills;
    prompts = ./prompts;
    themes = ./themes;
    extensions = ./extensions;
  };
  agentTools = pkgs.callPackage ./packages/pi-agent-tools.nix { };
  piResources = pkgs.callPackage ./packages/pi-resources.nix { };
  fffPackage = pkgs.callPackage ./packages/pi-packages/fff.nix { };
  mattPocockSkillsPackage = pkgs.runCommand "pi-package-mattpocock-skills" { } ''
    set -euo pipefail

    base="$out/share/pi-packages/mattpocock-skills"
    mkdir -p "$base"

    ${lib.concatMapStringsSep "\n" (
      skill: ''
        src_path="${config.pi.mattPocockSkills.source}/${skill}"
        dst_path="$base/${skill}"
        mkdir -p "$(dirname "$dst_path")"
        cp -R "$src_path" "$dst_path"
        chmod -R u+w "$dst_path"

        ${lib.optionalString (config.pi.mattPocockSkills.hiddenSkills != [ ]) ''
          case "${skill}" in
            ${lib.concatMapStringsSep "\n            " (skill: ''
              "${skill}")
                skill_md="$dst_path/SKILL.md"
                if ! grep -q '^disable-model-invocation:' "$skill_md"; then
                  sed -i '/^description:/a disable-model-invocation: true' "$skill_md"
                fi
                ;;
            '') config.pi.mattPocockSkills.hiddenSkills}
          esac
        ''}
      ''
    ) config.pi.mattPocockSkills.skills}
  '';
  piResourcePackageType = lib.types.submodule {
    options = {
      package = lib.mkOption {
        type = lib.types.package;
        description = "Nix package providing Pi resources.";
      };

      extensions = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Extension paths exposed by this Pi resource package.";
      };

      skills = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Skill directories exposed by this Pi resource package.";
      };

      prompts = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Prompt directories exposed by this Pi resource package.";
      };

      themes = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Theme directories exposed by this Pi resource package.";
      };
    };
  };
  resourcePackageResources = name: lib.concatMap (pkg: pkg.${name}) config.pi.resourcePackages;
  herdrPiExtension = "${config.pi.herdrIntegration.source}/src/integration/assets/pi/herdr-agent-state.ts";
  mattPocockResourcePackage = lib.optional config.pi.mattPocockSkills.enable {
    package = mattPocockSkillsPackage;
    skills = map (skill: "${mattPocockSkillsPackage}/share/pi-packages/mattpocock-skills/${skill}") config.pi.mattPocockSkills.skills;
  };
in
{
  imports = [ wlib.modules.default ];

  options.pi = {
    profileName = lib.mkOption {
      type = lib.types.nonEmptyStr;
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
      type = lib.types.str;
      default = "gpt-5.5";
      example = "openai-codex/gpt-5.4";
      description = "Default Pi model written to generated settings.json as `defaultModel`.";
    };

    resourcePackages = lib.mkOption {
      type = lib.types.listOf piResourcePackageType;
      default = [
        {
          package = fffPackage;
          extensions = [ "${fffPackage}/share/pi-packages/fff/src/index.ts" ];
        }
      ] ++ mattPocockResourcePackage;
      description = "Nix-built Pi packages exposed as generated settings resources.";
    };

    mattPocockSkills = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to expose selected Matt Pocock skills from a pinned upstream snapshot.";
      };

      source = lib.mkOption {
        type = lib.types.package;
        default = pkgs.fetchFromGitHub {
          owner = "mattpocock";
          repo = "skills";
          rev = "6eeb81b5fcfeeb5bd531dd47ab2f9f2bbea27461";
          hash = "sha256-6T0KwZcUIIbd6kpkQXPCnnJPVY2mEjxYjed4FjKnRAw=";
        };
        description = "Pinned Matt Pocock skills source checkout.";
      };

      skills = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [
          "skills/engineering/diagnosing-bugs"
          "skills/engineering/grill-with-docs"
          "skills/engineering/codebase-design"
          "skills/engineering/improve-codebase-architecture"
          "skills/engineering/domain-modeling"
          "skills/productivity/teach"
        ];
        example = [
          "skills/engineering/tdd"
          "skills/engineering/diagnosing-bugs"
        ];
        description = "Relative skill directories under the Matt Pocock skills source to expose to Pi.";
      };

      hiddenSkills = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [
          "skills/engineering/diagnosing-bugs"
          "skills/engineering/grill-with-docs"
          "skills/engineering/codebase-design"
          "skills/engineering/improve-codebase-architecture"
          "skills/engineering/domain-modeling"
          "skills/productivity/teach"
        ];
        example = [ "skills/engineering/diagnosing-bugs" ];
        description = "Subset of `pi.mattPocockSkills.skills` whose `SKILL.md` frontmatter should be patched with `disable-model-invocation: true`.";
        apply =
          hiddenSkills:
          let
            extras = lib.subtractLists config.pi.mattPocockSkills.skills hiddenSkills;
          in
          if extras == [ ] then
            hiddenSkills
          else
            throw "pi.mattPocockSkills.hiddenSkills must be a subset of pi.mattPocockSkills.skills. Extra entries: ${lib.concatStringsSep ", " extras}";
      };
    };

    settings = lib.mkOption {
      type = jsonFmtType;
      default = { };
      description = "Extra declarative Pi settings merged into generated settings.json.";
    };

    keybindings = lib.mkOption {
      type = jsonFmtType;
      default = {
        "tui.editor.cursorUp" = [
          "up"
          "ctrl+p"
        ];
        "tui.editor.cursorDown" = [
          "down"
          "ctrl+n"
        ];
        "tui.select.up" = [
          "up"
          "ctrl+p"
        ];
        "tui.select.down" = [
          "down"
          "ctrl+n"
        ];
        "app.model.cycleForward" = [ ];
        "app.session.togglePath" = [ ];
        "app.models.toggleProvider" = [ ];
        "app.session.toggleNamedFilter" = "ctrl+shift+n";
      };
      description = "Declarative Pi keybindings written to generated keybindings.json.";
    };

    herdrIntegration = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to declaratively load Herdr's Pi integration extension.";
      };

      source = lib.mkOption {
        type = lib.types.package;
        default = pkgs.fetchFromGitHub {
          owner = "ogulcancelik";
          repo = "herdr";
          rev = "569c33b094ca1161bf2431fd9aa2c48b87dd688e";
          hash = "sha256-1KBdx1PDcV3KYspbKJuv+ccaVMTWkSmujyMh68yXEEg=";
        };
        description = "Pinned Herdr source containing the Pi integration extension.";
      };
    };

    cheapModels = {
      primary = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "openai-codex/gpt-5.4-mini";
        description = "Primary cheap model exported as `PI_CHEAP_MODEL` for shared explore/tree/compaction model selection.";
      };

      fallbacks = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [
          "github-copilot/gpt-5.4-mini"
          "anthropic/claude-haiku-4-5"
        ];
        description = "Fallback cheap models exported as `PI_CHEAP_FALLBACK_MODELS` for shared explore/tree/compaction model selection.";
      };
    };

    appendSystemPrompt = lib.mkOption {
      type = lib.types.lines;
      default = ''
        # Response style

        Default voice: terse, precise, robot-like.

        - Lead with answer. No pleasantries, filler, hedging, or performative enthusiasm.
        - Prefer compact technical statements. Fragments OK when unambiguous.
        - Keep exact technical terms, paths, commands, errors, and code unchanged.
        - Use arrows for causality when concise: `X -> Y`.
        - Add detail only when it improves correctness, safety, or next action clarity.
        - For destructive, security-sensitive, or multi-step instructions, use clear full sentences.
        - If user asks for normal/plain/expanded wording, follow that request.
      '';
      description = "Markdown written to the profile-local `APPEND_SYSTEM.md` under `PI_CODING_AGENT_DIR`.";
    };
  };

  config = {
    package = lib.mkDefault inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
    binName = lib.mkDefault "p";

    install.modules =
      let
        launcherOnlyModule =
          packageAttr:
          { config, lib, ... }:
          {
            config =
              let
                cfg = config.wrappers.pi;
                launcherOnly = cfg.pkgs.runCommand "${cfg.binName}-launcher-only" { } ''
                  mkdir -p "$out/bin"
                  ln -s "${cfg.wrapper}/bin/${cfg.binName}" "$out/bin/${cfg.binName}"
                '';
              in
              lib.setAttrByPath packageAttr (lib.mkIf cfg.enable [ launcherOnly ]);
          };
      in
      {
        homeManager = lib.mkForce (launcherOnlyModule [ "home" "packages" ]);
        nixos = lib.mkForce (launcherOnlyModule [ "environment" "systemPackages" ]);
        darwin = lib.mkForce (launcherOnlyModule [ "environment" "systemPackages" ]);
      };

    envDefault = {
      PI_SKIP_VERSION_CHECK = "1";
      PI_TELEMETRY = "0";
    }
    // lib.optionalAttrs (config.pi.cheapModels.primary != null) {
      PI_CHEAP_MODEL = config.pi.cheapModels.primary;
    }
    // lib.optionalAttrs (config.pi.cheapModels.fallbacks != [ ]) {
      PI_CHEAP_FALLBACK_MODELS = lib.concatStringsSep "," config.pi.cheapModels.fallbacks;
    };

    runtimePkgs = [ agentTools ];

    drv.postBuild = ''
      rm -f "$out/bin/pi" "$out/bin/.pi-wrapped"
    '';

    constructFiles.generatedSettings = {
      relPath = "share/pi-wrapped/settings.json";
      content = builtins.toJSON (
        {
          defaultProjectTrust = "ask";
          defaultModel = config.pi.defaultModel;
          defaultThinkingLevel = "low";
          enableInstallTelemetry = false;
          theme = "gruvbox-dark-hard";
          enabledModels = [
            "openai-codex/gpt-5.4"
            "openai-codex/gpt-5.4-mini"
            "openai-codex/gpt-5.5"
          ];
          compaction = {
            enabled = true;
          };
          hideThinkingBlock = false;
          packages = config.pi.packages;
          skills = [ resourceDirs.skills ] ++ resourcePackageResources "skills";
          prompts = [ resourceDirs.prompts ] ++ resourcePackageResources "prompts";
          themes = [ resourceDirs.themes ] ++ resourcePackageResources "themes";
          extensions = [
            "${piResources}/share/pi-resources/extensions"
          ]
          ++ resourcePackageResources "extensions"
          ++ lib.optionals config.pi.herdrIntegration.enable [ herdrPiExtension ];
        }
        // config.pi.settings
      );
    };

    constructFiles.generatedKeybindings = {
      relPath = "share/pi-wrapped/keybindings.json";
      content = builtins.toJSON config.pi.keybindings;
    };

    constructFiles.generatedAgents = {
      relPath = "share/pi-wrapped/AGENTS.md";
      content = ''
        # Agent instructions

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
      '';
    };

    constructFiles.generatedAppendSystemPrompt = {
      relPath = "share/pi-wrapped/APPEND_SYSTEM.md";
      content = config.pi.appendSystemPrompt;
    };

    runShell = [
      ''
        profile_dir="${config.pi.stateRoot}/${config.pi.profileName}"
        mkdir -p "$profile_dir" "$profile_dir/sessions"
        rm -f "$profile_dir/settings.json"
        cp ${config.constructFiles.generatedSettings.path} "$profile_dir/settings.json"
        rm -f "$profile_dir/keybindings.json"
        cp ${config.constructFiles.generatedKeybindings.path} "$profile_dir/keybindings.json"
        rm -f "$profile_dir/AGENTS.md"
        cp ${config.constructFiles.generatedAgents.path} "$profile_dir/AGENTS.md"
        rm -f "$profile_dir/APPEND_SYSTEM.md"
        cp ${config.constructFiles.generatedAppendSystemPrompt.path} "$profile_dir/APPEND_SYSTEM.md"
        case "$0" in
          */*) launcher_bin="$0" ;;
          *) launcher_bin="$(command -v -- "$0" 2>/dev/null || printf '%s' "$0")" ;;
        esac
        export PI_LAUNCHER_BIN="$launcher_bin"
        export PI_CODING_AGENT_DIR="$profile_dir"
        export PI_PACKAGE_DIR="${config.package}/lib/node_modules/@earendil-works/pi-coding-agent"
        export PI_CODING_AGENT_SESSION_DIR="$profile_dir/sessions"
      ''
    ];
  };
}
