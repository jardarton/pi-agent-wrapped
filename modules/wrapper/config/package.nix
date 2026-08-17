context:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  wrapperConfig = config;
  inherit (context)
    agentTools
    chromeCdpPackage
    piPackages
    splashArgs
    ;
in
{
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
                cfg = wrapperConfig.install.getWrapperConfig config;
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

    runtimePkgs = [
      agentTools
    ]
    # Only the session-reader skill needs an interpreter. Consumers that want
    # Python available to the agent regardless can add it to `runtimePkgs`.
    ++ lib.optionals (builtins.elem "session-reader" config.pi.localSkills) [ pkgs.python3 ]
    ++ lib.optionals config.pi.nixOptions.enable [ pkgs.nix ]
    ++ lib.optionals config.pi.decompMatcher.enable [ pkgs.git ]
    ++ lib.optionals config.pi.review.enable [
      pkgs.git
      pkgs.gh
    ]
    ++ lib.optionals config.pi.chromeCdp.enable [ chromeCdpPackage ];

    # Drop the unwrapped upstream entrypoints so only the configured launcher is
    # exposed. `bin/.pi-wrapped` is the original binary displaced by the Pi
    # package's own `wrapProgram`.
    filesToExclude = [
      "bin/pi"
      "bin/.pi-wrapped"
    ];
  };
}
