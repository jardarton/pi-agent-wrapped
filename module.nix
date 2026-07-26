inputs:
{
  config,
  lib,
  pkgs,
  wlib,
  ...
}@top:
let
  jsonFmtType = wlib.types.structuredValueWith { typeName = "JSON"; };
  localSkillsDir = pkgs.runCommand "pi-wrapped-skills" { } ''
    mkdir -p "$out"
    ${lib.concatMapStringsSep "\n" (skill: ''
      mkdir -p "$out/$(dirname ${lib.escapeShellArg skill})"
      cp -R ${./skills}/${skill} "$out/${lib.escapeShellArg skill}"
    '') config.pi.localSkills}
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
  piPackages = import ./packages {
    inherit pkgs;
    piPackage = config.package;
  };
  agentTools = piPackages.pi-agent-tools;
  piResources = piPackages.pi-resources;
  fffPackage = piPackages.pi-fff;
  dynamicWorkflowsPackage = piPackages.pi-dynamic-workflows;
  codexGoalPackage = piPackages.pi-codex-goal;
  bundledExtensionPath = name: "${piResources}/share/pi-resources/extensions/${name}.ts";
  bundledExtensionNames = [
    "better-openai"
    "clanker-working-messages"
    "context"
    "explore"
    "herdr-terminal-images"
    "host-statusline"
    "librarian"
    "multi-edit"
    "split-fork"
    "todos"
    "tree-summary-model"
  ];
  bundledExtensionPaths = map bundledExtensionPath (
    lib.filter (
      name:
      builtins.elem name config.pi.bundledExtensions
      && (name != "librarian" || config.pi.librarian.mode == "tool")
    ) bundledExtensionNames
  );
  gondolinExtensionPath = bundledExtensionPath "gondolin";
  # Patching the splash rewrites Pi's own JavaScript, so it has to be done in the
  # package derivation rather than the wrapper output; see packages/pi/package.nix.
  # `null` leaves Pi's upstream splash alone and keeps the package identical to the
  # plain `.#pi` build.
  splashArgs =
    if config.pi.splash.enable then
      {
        logoText = builtins.toJSON config.pi.splash.logoText;
        versionText = builtins.toJSON config.pi.splash.versionText;
        compactHelpText = builtins.toJSON config.pi.splash.compactHelpText;
        helpText = builtins.toJSON config.pi.splash.helpText;
      }
    else
      null;
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
    if config.pi.defaultModel == null then
      { }
    else if builtins.length defaultModelParts > 1 then
      {
        defaultProvider = builtins.head defaultModelParts;
        defaultModel = lib.concatStringsSep "/" (builtins.tail defaultModelParts);
      }
    else
      {
        defaultModel = config.pi.defaultModel;
      };
  generatedExtensions =
    bundledExtensionPaths
    ++ lib.optionals config.pi.gondolin.enable [ gondolinExtensionPath ]
    ++ lib.optionals config.pi.camofoxBrowser.enable [
      "${piResources}/share/pi-resources/extensions/camofox-browser.ts"
    ]
    ++ lib.optionals config.pi.nixOptions.enable [
      "${piResources}/share/pi-resources/extensions/nix-options.ts"
    ]
    ++ resourcePackageResources "extensions"
    ++ lib.optionals config.pi.herdrIntegration.enable [
      herdrPiExtension
      (bundledExtensionPath "herdr-terminal-images")
    ];
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

    resourcePackages = lib.mkOption {
      type = lib.types.listOf piResourcePackageType;
      default =
        lib.optionals config.pi.fff.enable [
          {
            package = fffPackage;
            extensions = [ "${fffPackage}/share/pi-packages/fff/src/index.ts" ];
          }
        ]
        ++ lib.optionals config.pi.dynamicWorkflows.enable [
          {
            package = dynamicWorkflowsPackage;
            extensions = [
              "${dynamicWorkflowsPackage}/share/pi-packages/dynamic-workflows/extensions/workflow.ts"
            ];
          }
        ]
        ++ lib.optionals config.pi.goal.enable [
          {
            package = codexGoalPackage;
            extensions = [ "${codexGoalPackage}/share/pi-packages/codex-goal/src/index.ts" ];
            prompts = [ "${codexGoalPackage}/share/pi-packages/codex-goal/prompts" ];
          }
        ]
        ++ mattPocockResourcePackage;
      description = "Nix-built Pi packages exposed as generated settings resources.";
    };

    localSkills = lib.mkOption {
      type = lib.types.listOf (
        lib.types.enum (
          builtins.attrNames (lib.filterAttrs (_: type: type == "directory") (builtins.readDir ./skills))
        )
      );
      default = [ ];
      example = [
        "commit"
        "github"
      ];
      description = "Local bundled skill directories from ./skills to expose to Pi.";
    };

    bundledExtensions = lib.mkOption {
      type = lib.types.listOf (lib.types.enum bundledExtensionNames);
      default = [ ];
      example = bundledExtensionNames;
      description = "Bundled extension names to expose to Pi.";
    };

    fff.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged fff file-finder/grep extension.";
    };

    dynamicWorkflows.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged dynamic workflow extension.";
    };

    goal.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged Codex-style goal extension and prompt template.";
    };

    mattPocockSkills = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to expose selected Matt Pocock skills from a pinned upstream snapshot. Note: the default skill list is discovered with import-from-derivation.";
      };

      source = lib.mkOption {
        type = lib.types.package;
        default = pkgs.fetchFromGitHub {
          owner = "mattpocock";
          repo = "skills";
          rev = "ed37663cc5fbef691ddfecd080dff42f7e7e350d";
          hash = "sha256-o/H9s3t6ahBqFwpkOMBOTwpsvb33pgvpI9n0PA+uLYM=";
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

    herdrIntegration = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to declaratively load Herdr's Pi integration extension.";
      };

      source = lib.mkOption {
        type = lib.types.package;
        default = pkgs.fetchFromGitHub {
          owner = "ogulcancelik";
          repo = "herdr";
          rev = "c0fb777ed7c7950c6a2f397113c1842c2e679306";
          hash = "sha256-vhG8YWmGkKAps403O15qUc5swKinz7eJxhx/HHH4Ew0=";
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
        description = ''
          How to expose Librarian.

          `tool` loads the deterministic librarian tool, which additionally requires
          `librarian` in `pi.bundledExtensions`, and removes any `librarian` entry from
          `pi.localSkills` so the skill does not shadow the tool. Listing `librarian` in
          `pi.localSkills` alongside this mode is therefore harmless and has no effect.

          `skill` exposes the librarian skill from `pi.localSkills` and never loads the
          tool. Requesting the `librarian` extension in that mode is an error rather than
          a silently dropped extension.
        '';
        apply =
          mode:
          if mode == "skill" && builtins.elem "librarian" config.pi.bundledExtensions then
            throw "pi.librarian.mode = \"skill\" cannot be combined with \"librarian\" in pi.bundledExtensions: the librarian tool is not loaded in skill mode. Remove it from pi.bundledExtensions, or set pi.librarian.mode = \"tool\"."
          else
            mode;
      };
    };

    nixOptions.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to load the Nix flake module-option discovery and inspection tool.";
    };

    betterOpenAI.imageTool.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether the bundled Better OpenAI extension registers the agent-callable openai_image tool. The /openai-image command and other extension functionality remain available when disabled.";
    };

    camofoxBrowser = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to load the native Pi Camofox browser tools extension.";
      };

      url = lib.mkOption {
        type = lib.types.str;
        default = "http://localhost:9377";
        description = "Camofox Browser REST API base URL exported as CAMOFOX_URL.";
      };

      apiKeyFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Path to a file containing the Camofox Browser API key, exported as CAMOFOX_API_KEY_FILE when set.";
      };
    };

    cheapModels = {
      primary = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "openai-codex/gpt-5.6-luna";
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

      treeSummary.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the bundled tree-summary-model extension overrides Pi's /tree summarizer with cheap-model selection.";
      };

      compaction.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the bundled tree-summary-model extension overrides Pi's session compaction model with cheap-model selection.";
      };
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

  config = {
    package = lib.mkDefault (piPackages.pi.override { splashPatch = splashArgs; });
    binName = lib.mkDefault "p";

    meta = {
      description = "Declarative, configurable Pi coding-agent wrapper";
      platforms = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    };

    install.modules =
      let
        launcherOnlyModule =
          packageAttr:
          { config, lib, ... }:
          {
            config =
              let
                # Resolve the wrapper config through the documented accessor rather than a
                # hardcoded `config.wrappers.pi`, so this keeps working at whatever
                # `install.optionLocation` the module was instantiated at.
                cfg = top.config.install.getWrapperConfig config;
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
      PI_TREE_SUMMARY_MODEL_ENABLED = if config.pi.cheapModels.treeSummary.enable then "1" else "0";
      PI_COMPACTION_MODEL_ENABLED = if config.pi.cheapModels.compaction.enable then "1" else "0";
    }
    // lib.optionalAttrs config.pi.gondolin.enable {
      PI_GONDOLIN_ENABLED = "1";
      PI_GONDOLIN_GUEST_MOUNT_PATH = config.pi.gondolin.guestMountPath;
    }
    // lib.optionalAttrs config.pi.betterOpenAI.imageTool.enable {
      PI_BETTER_OPENAI_IMAGE_TOOL = "1";
    }
    // lib.optionalAttrs config.pi.camofoxBrowser.enable (
      {
        CAMOFOX_URL = config.pi.camofoxBrowser.url;
      }
      // lib.optionalAttrs (config.pi.camofoxBrowser.apiKeyFile != null) {
        CAMOFOX_API_KEY_FILE = config.pi.camofoxBrowser.apiKeyFile;
      }
    )
    // lib.optionalAttrs (config.pi.cheapModels.primary != null) {
      PI_CHEAP_MODEL = config.pi.cheapModels.primary;
    }
    // lib.optionalAttrs (config.pi.cheapModels.fallbacks != [ ]) {
      PI_CHEAP_FALLBACK_MODELS = lib.concatStringsSep "," config.pi.cheapModels.fallbacks;
    };

    runtimePkgs = [
      agentTools
    ]
    # Only the session-reader skill needs an interpreter. Consumers that want
    # Python available to the agent regardless can add it to `runtimePkgs`.
    ++ lib.optionals (builtins.elem "session-reader" config.pi.localSkills) [ pkgs.python3 ]
    ++ lib.optionals config.pi.nixOptions.enable [ pkgs.nix ];

    # Drop the unwrapped upstream entrypoints so only the configured launcher is
    # exposed. `bin/.pi-wrapped` is the original binary displaced by the Pi
    # package's own `wrapProgram`.
    filesToExclude = [
      "bin/pi"
      "bin/.pi-wrapped"
    ];

    constructFiles.generatedSettings = {
      relPath = "share/pi-wrapped/settings.json";
      content = builtins.toJSON (
        config.pi.settings
        // generatedDefaultModel
        // lib.optionalAttrs (config.pi.defaultThinkingLevel != null) {
          defaultThinkingLevel = config.pi.defaultThinkingLevel;
        }
        // lib.optionalAttrs (config.pi.theme != null) { theme = config.pi.theme; }
        // lib.optionalAttrs (config.pi.enabledModels != [ ]) {
          enabledModels = config.pi.enabledModels;
        }
        // {
          defaultProjectTrust = config.pi.projectTrust;
          enableInstallTelemetry = false;
          packages = config.pi.packages;
          skills = [ resourceDirs.skills ] ++ resourcePackageResources "skills";
          prompts = [ resourceDirs.prompts ] ++ resourcePackageResources "prompts";
          themes = [ resourceDirs.themes ] ++ resourcePackageResources "themes";
          extensions = generatedExtensions;
        }
      );
    };

    constructFiles.generatedKeybindings = {
      relPath = "share/pi-wrapped/keybindings.json";
      content = builtins.toJSON config.pi.keybindings;
    };

    constructFiles.generatedAgents = {
      relPath = "share/pi-wrapped/AGENTS.md";
      # Single-sourced with the repository's own AGENTS.md, which links to the same file.
      content = ''
        # Agent instructions

        ${builtins.readFile ./docs/pi-native-children.md}
      '';
    };

    constructFiles.generatedAppendSystemPrompt = {
      relPath = "share/pi-wrapped/APPEND_SYSTEM.md";
      content =
        if config.pi.overrideSystemPrompt != null then
          config.pi.overrideSystemPrompt
        else
          config.pi.appendSystemPrompt;
    };

    runShell = [
      # Gondolin image discovery can shell out to `nix build`, so it must only run
      # for profiles that actually enable Gondolin. Emitting it unconditionally made
      # every launch inside any flake directory pay for a Nix evaluation.
      (lib.optionalString config.pi.gondolin.enable ''
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

        if resolved_gondolin_image_path="$(resolve_gondolin_image_path)"; then
          export GONDOLIN_IMAGE_PATH="$resolved_gondolin_image_path"
        fi
      '')
      ''
        profile_name=${lib.escapeShellArg config.pi.profileName}
        profile_dir="${config.pi.stateRoot}/$profile_name"
        mkdir -p "$profile_dir" "$profile_dir/sessions"
        copy_generated() {
          rm -f "$profile_dir/$2"
          cp "$1" "$profile_dir/$2"
          chmod 0644 "$profile_dir/$2"
        }
        copy_generated ${config.constructFiles.generatedSettings.path} settings.json
        copy_generated ${config.constructFiles.generatedKeybindings.path} keybindings.json
        copy_generated ${config.constructFiles.generatedAgents.path} AGENTS.md
        copy_generated ${config.constructFiles.generatedAppendSystemPrompt.path} APPEND_SYSTEM.md
        case "$0" in
          */*) launcher_candidate="$0" ;;
          *) launcher_candidate="$(command -v -- "$0" 2>/dev/null || true)" ;;
        esac
        if [ -z "$launcher_candidate" ]; then
          printf '%s\n' "pi wrapper: unable to resolve launcher path for $0" >&2
          exit 1
        fi
        if ! launcher_bin="$(${pkgs.coreutils}/bin/readlink -f -- "$launcher_candidate")"; then
          printf '%s\n' "pi wrapper: unable to canonicalize launcher path: $launcher_candidate" >&2
          exit 1
        fi
        if [ ! -f "$launcher_bin" ] || [ ! -x "$launcher_bin" ]; then
          printf '%s\n' "pi wrapper: canonical launcher is not an executable file: $launcher_bin" >&2
          exit 1
        fi
        export PI_LAUNCHER_BIN="$launcher_bin"
        export PI_CODING_AGENT_DIR="$profile_dir"
        export PI_PACKAGE_DIR="${config.package}/lib/node_modules/@earendil-works/pi-coding-agent"
        export PI_CODING_AGENT_SESSION_DIR="$profile_dir/sessions"
      ''
    ];
  };
}
