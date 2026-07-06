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
  localSkillsDir = pkgs.runCommand "pi-wrapped-skills" { } ''
    mkdir -p "$out"
    cp -R ${./skills}/. "$out/"
    chmod -R u+w "$out"
    ${lib.optionalString (config.pi.librarian.mode == "tool") ''
      rm -rf "$out/librarian"
    ''}
  '';
  resourceDirs = {
    skills = localSkillsDir;
    prompts = ./prompts;
    themes = ./themes;
    extensions = ./extensions;
  };
  agentTools = pkgs.callPackage ./packages/pi-agent-tools.nix { };
  piResources = pkgs.callPackage ./packages/pi-resources.nix { };
  fffPackage = pkgs.callPackage ./packages/pi-packages/fff.nix { };
  dynamicWorkflowsPackage = pkgs.callPackage ./packages/pi-packages/dynamic-workflows.nix { };
  bundledExtensionPath = name: "${piResources}/share/pi-resources/extensions/${name}.ts";
  bundledExtensionNames = [
    "clanker-working-messages"
    "context"
    "explore"
    "host-statusline"
    "librarian"
    "multi-edit"
    "split-fork"
    "todos"
    "tree-summary-model"
  ];
  bundledExtensionPaths = map bundledExtensionPath (
    lib.filter (name: name != "librarian" || config.pi.librarian.mode == "tool") bundledExtensionNames
  );
  gondolinExtensionPath = bundledExtensionPath "gondolin";
  defaultAppendSystemPrompt = ''
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
  splashLogoTextJson = builtins.toJSON config.pi.splash.logoText;
  splashVersionTextJson = builtins.toJSON config.pi.splash.versionText;
  splashCompactHelpTextJson = builtins.toJSON config.pi.splash.compactHelpText;
  splashHelpTextJson = builtins.toJSON config.pi.splash.helpText;
  mattPocockSkillsPackage = pkgs.runCommand "pi-package-mattpocock-skills" { } ''
    set -euo pipefail

    base="$out/share/pi-packages/mattpocock-skills"
    mkdir -p "$base"

    ${lib.concatMapStringsSep "\n" (skill: ''
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
    '') config.pi.mattPocockSkills.skills}
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
  defaultModelParts = lib.splitString "/" config.pi.defaultModel;
  generatedDefaultModel =
    if builtins.length defaultModelParts > 1 then
      {
        defaultProvider = builtins.head defaultModelParts;
        defaultModel = lib.concatStringsSep "/" (builtins.tail defaultModelParts);
      }
    else
      {
        defaultModel = config.pi.defaultModel;
      };
  herdrPiExtension = "${config.pi.herdrIntegration.source}/src/integration/assets/pi/herdr-agent-state.ts";
  mattPocockResourcePackage = lib.optional config.pi.mattPocockSkills.enable {
    package = mattPocockSkillsPackage;
    skills = map (
      skill: "${mattPocockSkillsPackage}/share/pi-packages/mattpocock-skills/${skill}"
    ) config.pi.mattPocockSkills.skills;
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
      default = "openai-codex/gpt-5.5";
      example = "openai-codex/gpt-5.4";
      description = "Default Pi model. Use a fully-qualified provider/model id; generated settings split it into `defaultProvider` and `defaultModel` for Pi.";
    };

    theme = lib.mkOption {
      type = lib.types.str;
      default = "gruvbox-dark-hard";
      example = "gruvbox-dark-hard";
      description = "Default Pi theme written to generated settings.json as `theme`.";
    };

    resourcePackages = lib.mkOption {
      type = lib.types.listOf piResourcePackageType;
      default = [
        {
          package = fffPackage;
          extensions = [ "${fffPackage}/share/pi-packages/fff/src/index.ts" ];
        }
        {
          package = dynamicWorkflowsPackage;
          extensions = [
            "${dynamicWorkflowsPackage}/share/pi-packages/dynamic-workflows/extensions/workflow.ts"
          ];
        }
      ]
      ++ mattPocockResourcePackage;
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
          rev = "272f99b22574f50e4266791c86b9302682970e23";
          hash = "sha256-3muzsPd/1OgGgG+aIpXWUm9R2Lxa1I/geJxmNL8VJAY=";
        };
        description = "Pinned Matt Pocock skills source checkout.";
      };

      skills = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default =
          let
            source = config.pi.mattPocockSkills.source;
            skillDirsFor =
              category:
              let
                categoryPath = "${source}/skills/${category}";
                entries = builtins.readDir categoryPath;
              in
              lib.mapAttrsToList (name: _: "skills/${category}/${name}") (
                lib.filterAttrs (
                  name: type: type == "directory" && builtins.pathExists "${categoryPath}/${name}/SKILL.md"
                ) entries
              );
          in
          lib.sort builtins.lessThan (
            lib.concatMap skillDirsFor [
              "engineering"
              "in-progress"
            ]
          );
        example = [
          "skills/engineering/tdd"
          "skills/engineering/diagnosing-bugs"
        ];
        description = "Relative skill directories under the Matt Pocock skills source to expose to Pi.";
      };

      hiddenSkills = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = config.pi.mattPocockSkills.skills;
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
          rev = "659c3f51ece42b7b761084bca0152fe4db56ebf6";
          hash = "sha256-nVcW9Tc3zNHPZ8G/pikbE4gSHg2Dwhi4LCePV/OuuQw=";
        };
        description = "Pinned Herdr source containing the Pi integration extension.";
      };
    };

    gondolin = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to declaratively load the bundled Gondolin routing extension and start with Gondolin enabled.";
      };

      imagePath = lib.mkOption {
        type = lib.types.nullOr (lib.types.either lib.types.str lib.types.package);
        default = null;
        example = "./result-gondolin-image";
        description = "Preferred Gondolin guest asset directory. When null, the launcher falls back to a cwd-local `.#gondolin-image` flake output, then `GONDOLIN_IMAGE_PATH`, then Gondolin's own default image resolution.";
      };

      guestMountPath = lib.mkOption {
        type = lib.types.str;
        default = "/workspace";
        description = "Guest mount path exported as `PI_GONDOLIN_GUEST_MOUNT_PATH` when `pi.gondolin.enable = true`.";
      };
    };

    librarian = {
      mode = lib.mkOption {
        type = lib.types.enum [
          "tool"
          "skill"
        ];
        default = "tool";
        example = "skill";
        description = "How to expose Librarian. `tool` registers the deterministic librarian tool and hides the librarian skill; `skill` exposes the librarian skill and does not load the tool.";
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
      default = "";
      description = "Extra Markdown appended after the wrapper default in profile-local `APPEND_SYSTEM.md` under `PI_CODING_AGENT_DIR`.";
    };

    overrideSystemPrompt = lib.mkOption {
      type = lib.types.nullOr lib.types.lines;
      default = null;
      description = "When set, replaces the entire profile-local `APPEND_SYSTEM.md` under `PI_CODING_AGENT_DIR` instead of using the wrapper default plus `pi.appendSystemPrompt`.";
    };

    splash = {
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
        homeManager = lib.mkForce (launcherOnlyModule [
          "home"
          "packages"
        ]);
        nixos = lib.mkForce (launcherOnlyModule [
          "environment"
          "systemPackages"
        ]);
        darwin = lib.mkForce (launcherOnlyModule [
          "environment"
          "systemPackages"
        ]);
      };

    envDefault = {
      PI_SKIP_VERSION_CHECK = "1";
      PI_TELEMETRY = "0";
    }
    // lib.optionalAttrs config.pi.gondolin.enable {
      PI_GONDOLIN_ENABLED = "1";
      PI_GONDOLIN_GUEST_MOUNT_PATH = config.pi.gondolin.guestMountPath;
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

      interactive_mode="$out/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js"
      if [ -f "$interactive_mode" ]; then
        splash_logo_text=${lib.escapeShellArg splashLogoTextJson}
        splash_version_text=${lib.escapeShellArg splashVersionTextJson}
        splash_compact_help_text=${lib.escapeShellArg splashCompactHelpTextJson}
        splash_help_text=${lib.escapeShellArg splashHelpTextJson}
        SPLASH_LOGO_TEXT="$splash_logo_text" SPLASH_VERSION_TEXT="$splash_version_text" ${pkgs.perl}/bin/perl -0pi -e 's/const logo = theme\.bold\(theme\.fg\("accent", APP_NAME\)\) \+ theme\.fg\("dim", ` v\$\{this\.version\}`\);/const logo = theme.bold(theme.fg("accent", $ENV{SPLASH_LOGO_TEXT})) + ($ENV{SPLASH_VERSION_TEXT} === "null" ? "" : theme.fg("dim", $ENV{SPLASH_VERSION_TEXT}.replace("{version}", this.version)));/' "$interactive_mode"
        SPLASH_COMPACT_HELP_TEXT="$splash_compact_help_text" ${pkgs.perl}/bin/perl -0pi -e 's/const compactOnboarding = theme\.fg\("dim", `Press \$\{keyText\("app\.tools\.expand"\)\} to show full startup help and loaded resources\.`\);/const compactOnboarding = theme.fg("dim", $ENV{SPLASH_COMPACT_HELP_TEXT}.replace("{expandKey}", keyText("app.tools.expand")));/' "$interactive_mode"
        SPLASH_HELP_TEXT="$splash_help_text" ${pkgs.perl}/bin/perl -0pi -e 's/const onboarding = theme\.fg\("dim", `Pi can explain its own features and look up its docs\. Ask it how to use or extend Pi\.`\);/const onboarding = theme.fg("dim", $ENV{SPLASH_HELP_TEXT});/' "$interactive_mode"
      fi
    '';

    constructFiles.generatedSettings = {
      relPath = "share/pi-wrapped/settings.json";
      content = builtins.toJSON (
        {
          defaultProjectTrust = "ask";
          defaultThinkingLevel = "low";
          enableInstallTelemetry = false;
          theme = config.pi.theme;
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
          extensions =
            bundledExtensionPaths
            ++ lib.optionals config.pi.gondolin.enable [ gondolinExtensionPath ]
            ++ resourcePackageResources "extensions"
            ++ lib.optionals config.pi.herdrIntegration.enable [ herdrPiExtension ];
        }
        // generatedDefaultModel
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
      content =
        if config.pi.overrideSystemPrompt != null then
          config.pi.overrideSystemPrompt
        else
          defaultAppendSystemPrompt + config.pi.appendSystemPrompt;
    };

    runShell = [
      ''
        configured_gondolin_image_path=${
          if config.pi.gondolin.imagePath == null then
            "''"
          else
            lib.escapeShellArg (toString config.pi.gondolin.imagePath)
        }

        resolve_gondolin_image_path() {
          if [ -f flake.nix ]; then
            if resolved_path="$(${pkgs.nix}/bin/nix --extra-experimental-features 'nix-command flakes' build .#gondolin-image --no-link --print-out-paths 2>/dev/null | tail -n 1)" && [ -n "$resolved_path" ]; then
              printf '%s\n' "$resolved_path"
              return 0
            fi
          fi

          if [ -n "''${GONDOLIN_IMAGE_PATH-}" ]; then
            printf '%s\n' "$GONDOLIN_IMAGE_PATH"
            return 0
          fi

          if [ -n "$configured_gondolin_image_path" ]; then
            printf '%s\n' "$configured_gondolin_image_path"
            return 0
          fi

          return 1
        }

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
        if resolved_gondolin_image_path="$(resolve_gondolin_image_path)"; then
          export GONDOLIN_IMAGE_PATH="$resolved_gondolin_image_path"
        fi
      ''
    ];
  };
}
