inputs:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.piProfiles.camofoxBrowser;
  piCamofoxWrapped =
    (inputs.self.wrappers.pi.extendModules {
      modules = [
        ./camofox-browser.nix
        {
          binName = cfg.binName;
          pi = {
            profileName = lib.mkForce cfg.profileName;
            camofoxBrowser = {
              url = lib.mkForce cfg.url;
              apiKeyFile = cfg.apiKeyFile;
            };
            herdrSubagents = {
              enable = cfg.herdrSubagentsPackage != null;
              package = cfg.herdrSubagentsPackage;
            };
          };
        }
      ];
    }).config.wrap
      { inherit pkgs; };
  piCamofoxLauncher = pkgs.runCommand "${cfg.binName}-launcher-only" { } ''
    mkdir -p "$out/bin"
    ln -s "${piCamofoxWrapped}/bin/${cfg.binName}" "$out/bin/${cfg.binName}"
  '';
  agentTools = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.pi-agent-tools;
  runCurrentPi = "${agentTools}/bin/run-current-pi";
  camofoxLauncher = "${piCamofoxWrapped}/bin/${cfg.binName}";
  setupRecord = (pkgs.formats.json { }).generate "delegate-with-herdr-setup-record.json" {
    schemaVersion = 1;
    generator = "pi-herdr-subagents/setup-herdr-subagents";
    skillName = "delegate-with-herdr";
    scope = "global";
    ownership = "declarative";
    sourcePath = "pi-agent-wrapped/profiles/home-camofox-browser.nix";
    discoveryWiring = [
      "~/.local/state/pi-wrapped/default/skills/delegate-with-herdr"
      "~/.local/state/pi-wrapped/${cfg.profileName}/skills/delegate-with-herdr"
    ];
    delegatingProfiles = [
      "default"
      cfg.profileName
    ];
    leafProfiles = [ "minimal" ];
    recipes = [
      {
        id = "same-profile-pi";
        executable = runCurrentPi;
        validation = "static";
      }
      {
        id = "camofox-pi";
        executable = camofoxLauncher;
        validation = "static";
      }
    ];
  };
  delegateSkill = pkgs.runCommand "delegate-with-herdr-skill" { } ''
    mkdir -p "$out/references"
    cp ${./assets/delegate-with-herdr/SKILL.md} "$out/SKILL.md"
    substitute ${./assets/delegate-with-herdr/recipes.md.in} "$out/references/recipes.md" \
      --replace-fail '@runCurrentPi@' ${lib.escapeShellArg runCurrentPi} \
      --replace-fail '@camofoxLauncher@' ${lib.escapeShellArg camofoxLauncher}
    cp ${setupRecord} "$out/references/setup-record.json"
  '';
in
{
  options.piProfiles.camofoxBrowser = {
    enable = lib.mkEnableOption "standalone Pi Camofox browser profile launcher";

    binName = lib.mkOption {
      type = lib.types.nonEmptyStr;
      default = "p-camofox";
      description = "Executable name for the standalone Camofox Pi profile launcher.";
    };

    profileName = lib.mkOption {
      type = lib.types.nonEmptyStr;
      default = "pi-camofox";
      description = "Mutable Pi profile name used by the Camofox launcher.";
    };

    url = lib.mkOption {
      type = lib.types.str;
      default = "http://localhost:9377";
      description = "Camofox Browser REST API base URL.";
    };

    apiKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional file containing the Camofox Browser API key.";
    };

    herdrSubagentsPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = "Optional pi-herdr-subagents package exposed by this profile.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ piCamofoxLauncher ];
    home.file = lib.mkIf (cfg.herdrSubagentsPackage != null) {
      ".local/state/pi-wrapped/default/skills/delegate-with-herdr".source = delegateSkill;
      ".local/state/pi-wrapped/${cfg.profileName}/skills/delegate-with-herdr".source = delegateSkill;
    };
  };
}
