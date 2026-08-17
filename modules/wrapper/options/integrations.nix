{
  config,
  lib,
  pkgs,
  ...
}:
{
  options.pi = {
    decompMatcher = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to enable the bounded decompilation matcher child-job extension.";
      };

      jobRoot = lib.mkOption {
        type = lib.types.str;
        default = ".pi/decomp-matcher-jobs";
        description = "Directory, relative to the Pi launch working directory when relative, in which retained matcher jobs are created.";
      };

      allowedModels = lib.mkOption {
        type = lib.types.listOf (
          lib.types.submodule {
            options = {
              provider = lib.mkOption { type = lib.types.str; };
              model = lib.mkOption { type = lib.types.str; };
              reasoning = lib.mkOption {
                type = lib.types.enum [
                  "off"
                  "minimal"
                  "low"
                  "medium"
                  "high"
                  "xhigh"
                  "max"
                ];
              };
            };
          }
        );
        default = [ ];
        description = "Explicit provider, model, and reasoning triples that the matcher may launch.";
      };

      defaultModel = lib.mkOption {
        type = lib.types.nullOr (
          lib.types.submodule {
            options = {
              provider = lib.mkOption { type = lib.types.str; };
              model = lib.mkOption { type = lib.types.str; };
              reasoning = lib.mkOption {
                type = lib.types.enum [
                  "off"
                  "minimal"
                  "low"
                  "medium"
                  "high"
                  "xhigh"
                  "max"
                ];
              };
            };
          }
        );
        default = null;
        description = "Default allowlisted provider, model, and reasoning triple for matcher jobs.";
      };
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

  };
}
