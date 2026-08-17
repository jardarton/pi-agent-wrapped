_inputs:
{
  config,
  lib,
  pkgs,
  wlib,
  ...
}:
let
  context = import ./modules/wrapper/context.nix {
    inherit
      config
      lib
      pkgs
      wlib
      ;
  };
in
{
  imports = [
    wlib.modules.default
    (import ./modules/wrapper/options/general.nix context)
    (import ./modules/wrapper/options/resources.nix context)
    ./modules/wrapper/options/integrations.nix
    (import ./modules/wrapper/config/package.nix context)
    ./modules/wrapper/config/environment.nix
    (import ./modules/wrapper/config/generated-files.nix context)
    ./modules/wrapper/config/launcher.nix
  ];
}
