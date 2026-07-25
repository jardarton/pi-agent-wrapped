{
  pkgs,
  # Forwarded explicitly rather than left to callPackage's automatic arguments.
  # Anything named after an existing nixpkgs attribute would otherwise be filled
  # in silently from pkgs.
  splashPatch ? null,
  ...
}:

pkgs.callPackage ./package.nix { inherit splashPatch; }
