context:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (context)
    bundledExtensionNames
    clarifyPackage
    codexConversionPackage
    codexGoalPackage
    dynamicWorkflowsPackage
    fffPackage
    mattPocockResourcePackage
    mcpAdapterPackage
    metaOAuthPackage
    piResourcePackageType
    pstackResourcePackage
    reviewPackage
    chromeCdpPackage
    ;
  enabledResourcePackages =
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
    ++ lib.optionals config.pi.mcpAdapter.enable [
      {
        package = mcpAdapterPackage;
        extensions = [ "${mcpAdapterPackage}/share/pi-packages/mcp-adapter/index.ts" ];
      }
    ]
    ++ lib.optionals config.pi.review.enable [
      {
        package = reviewPackage;
        extensions = [ "${reviewPackage}/share/pi-packages/pi-review/review.ts" ];
      }
    ]
    ++ lib.optionals config.pi.clarify.enable [
      {
        package = clarifyPackage;
        extensions = [ "${clarifyPackage}/share/pi-packages/clarify/extensions/clarify.ts" ];
      }
    ]
    ++ lib.optionals config.pi.metaOAuth.enable [
      {
        package = metaOAuthPackage;
        extensions = [ "${metaOAuthPackage}/share/pi-packages/meta-oauth/meta.ts" ];
      }
    ]
    ++ lib.optionals config.pi.chromeCdp.enable [
      {
        package = chromeCdpPackage;
        skills = [ "${chromeCdpPackage}/share/pi-packages/chrome-cdp/skills/chrome-cdp" ];
      }
    ]
    ++ lib.optionals config.pi.codexConversion.enable [
      {
        package = codexConversionPackage;
        extensions = [
          "${codexConversionPackage}/share/pi-packages/codex-conversion/dist/index.js"
        ];
      }
    ]
    ++ mattPocockResourcePackage
    ++ pstackResourcePackage;
in
{
  options.pi = {
    resourcePackages = lib.mkOption {
      type = lib.types.listOf piResourcePackageType;
      default = [ ];
      description = "Nix-built Pi packages exposed as generated settings resources.";
    };

    localSkills = lib.mkOption {
      type = lib.types.listOf (
        lib.types.enum (
          builtins.attrNames (
            lib.filterAttrs (_: type: type == "directory") (builtins.readDir ../../../skills)
          )
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

    mcpAdapter.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged MCP adapter extension.";
    };

    goal.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged Codex-style goal extension and prompt template.";
    };

    review.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged Earendil code review extension and its Git dependencies.";
    };

    clarify.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged prompt clarification extension.";
    };

    metaOAuth.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the OAuth-only Meta Model API provider extension.";
    };

    chromeCdp.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged chrome-cdp skill for interacting with a live local browser session.";
    };

    codexConversion.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to expose the packaged pi-codex-conversion extension, which gives GPT models Codex-shaped tools and prompt handling.";
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
          rev = "3cca18b368ae95cdbdebbff572ccafa662551015";
          hash = "sha256-dF5i37jHnqfcXD1IRSVzSSm/pfCYSUmOsEhhs5Zx340=";
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

    pstackSkills = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to expose selected pstack skills from the pinned Cursor plugins snapshot.";
      };

      source = lib.mkOption {
        type = lib.types.package;
        default = pkgs.fetchFromGitHub {
          owner = "cursor";
          repo = "plugins";
          rev = "2b8ae2ee306f823d54879d3da7f8496b73c31d5d";
          hash = "sha256-Yw8VwNSxuYDyv7b/EiJ/GY6RMcoWiYtWcUP1n5btP+0=";
        };
        description = "Pinned Cursor plugins source checkout containing the pstack skills.";
      };

      skills = lib.mkOption {
        type = lib.types.listOf (
          lib.types.enum (
            builtins.attrNames (
              lib.filterAttrs (
                name: type:
                type == "directory"
                && builtins.pathExists "${config.pi.pstackSkills.source}/pstack/skills/${name}/SKILL.md"
              ) (builtins.readDir "${config.pi.pstackSkills.source}/pstack/skills")
            )
          )
        );
        default = [ ];
        example = [
          "blast-radius"
          "how"
          "tdd"
        ];
        description = "Names of pstack skill directories to expose to Pi.";
      };
    };

  };

  config.pi.resourcePackages = lib.mkBefore enabledResourcePackages;
}
