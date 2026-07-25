# Aggregated Pi package set.
#
# Imported by both `flake.nix` and `module.nix` so the list of packages and the
# arguments they are called with cannot drift between the flake outputs and the
# wrapper module.
#
# `piPackage` lets the wrapper module substitute its own `config.package` (which
# a consumer may have overridden) for the default source-built Pi.
{
  pkgs,
  piPackage ? null,
}:
let
  inherit (pkgs) callPackage;
  pi = callPackage ./pi { };
in
{
  inherit pi;
  pi-agent-tools = callPackage ./pi-agent-tools.nix { };
  pi-resources = callPackage ./pi-resources.nix {
    piPackage = if piPackage == null then pi else piPackage;
  };
  pi-fff = callPackage ./pi-packages/fff.nix { };
  pi-dynamic-workflows = callPackage ./pi-packages/dynamic-workflows.nix { };
  pi-codex-goal = callPackage ./pi-packages/codex-goal.nix { };
}
