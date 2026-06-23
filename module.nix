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
  fffPackage = pkgs.callPackage ./packages/pi-packages/fff.nix { };
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

    resourcePackages = lib.mkOption {
      type = lib.types.listOf piResourcePackageType;
      default = [
        {
          package = fffPackage;
          extensions = [ "${fffPackage}/share/pi-packages/fff/src/index.ts" ];
        }
      ];
      description = "Nix-built Pi packages exposed as generated settings resources.";
    };

    settings = lib.mkOption {
      type = jsonFmtType;
      default = { };
      description = "Extra declarative Pi settings merged into generated settings.json.";
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
  };

  config = {
    package = lib.mkDefault inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
    binName = lib.mkDefault "pi";

    envDefault = {
      PI_SKIP_VERSION_CHECK = "1";
      PI_TELEMETRY = "0";
    };

    runtimePkgs = [ agentTools ];

    constructFiles.generatedSettings = {
      relPath = "share/pi-wrapped/settings.json";
      content = builtins.toJSON (
        {
          defaultProjectTrust = "ask";
          enableInstallTelemetry = false;
          packages = config.pi.packages;
          skills = [ resourceDirs.skills ] ++ resourcePackageResources "skills";
          prompts = [ resourceDirs.prompts ] ++ resourcePackageResources "prompts";
          themes = [ resourceDirs.themes ] ++ resourcePackageResources "themes";
          extensions = [
            resourceDirs.extensions
          ]
          ++ resourcePackageResources "extensions"
          ++ lib.optionals config.pi.herdrIntegration.enable [ herdrPiExtension ];
        }
        // config.pi.settings
      );
    };

    runShell = [
      ''
        profile_dir="${config.pi.stateRoot}/${config.pi.profileName}"
        mkdir -p "$profile_dir" "$profile_dir/packages" "$profile_dir/sessions"
        rm -f "$profile_dir/settings.json"
        cp ${config.constructFiles.generatedSettings.path} "$profile_dir/settings.json"
        export PI_CODING_AGENT_DIR="$profile_dir"
        export PI_PACKAGE_DIR="$profile_dir/packages"
        export PI_CODING_AGENT_SESSION_DIR="$profile_dir/sessions"
      ''
    ];
  };
}
