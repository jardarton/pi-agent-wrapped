{
  description = "Declarative, configurable Pi coding-agent wrappers";

  inputs = {
    # `nixos-unstable`, not `nixpkgs-unstable`: the consumer repository builds this
    # flake with its own `nixos-unstable` nixpkgs through `follows`. Tracking the
    # faster branch here would check this repository against a newer tree than the
    # one that actually builds it, so a break would only appear downstream.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    nix-wrapper-modules.url = "github:BirdeeHub/nix-wrapper-modules";
    nix-wrapper-modules.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      nix-wrapper-modules,
      ...
    }@inputs:
    let
      nixpkgsLib = nixpkgs.lib;
      systems = nixpkgsLib.systems.flakeExposed;
      forEachSystem = nixpkgsLib.genAttrs systems;
      # One nixpkgs instantiation per system, shared by `packages`, `devShells`
      # and `formatter`. Importing nixpkgs separately in each of those outputs
      # evaluated the fixpoint three times per system.
      pkgsFor = forEachSystem (system: import nixpkgs { inherit system; });
      wrapperModule = nixpkgsLib.modules.importApply ./module.nix inputs;
      wrapper = nix-wrapper-modules.lib.evalModule wrapperModule;
      mkProfile = import ./lib/mk-profile.nix {
        lib = nixpkgsLib;
        inherit wrapper;
      };
      homeManagerModule = nixpkgsLib.modules.importApply ./modules/home-manager.nix inputs;
    in
    {
      lib = {
        inherit mkProfile;
      };

      wrapperModules = {
        pi = wrapperModule;
        default = self.wrapperModules.pi;
      };

      wrappers = {
        pi = wrapper.config;
        default = self.wrappers.pi;
      };

      packages = forEachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        import ./packages { inherit pkgs; }
        // rec {
          pi-wrapped = self.wrappers.pi.wrap { inherit pkgs; };
          p = self.lib.mkProfile {
            inherit pkgs;
            profileName = "default";
            binName = "p";
          };
          default = p;
        }
      );

      apps = forEachSystem (system: rec {
        p = {
          type = "app";
          program = "${self.packages.${system}.p}/bin/p";
        };
        default = p;
      });

      nixosModules = {
        pi = nix-wrapper-modules.lib.getInstallModule {
          name = "pi";
          value = wrapperModule;
        };
        default = self.nixosModules.pi;
      };

      # The install module dispatches on the target evaluation's `_class`, so the
      # same value serves nixos, home-manager and nix-darwin.
      darwinModules = self.nixosModules;

      homeModules = {
        pi = homeManagerModule;
        wrapper = self.nixosModules.pi;
        default = self.homeModules.pi;
      };

      homeManagerModules = self.homeModules;

      # `pi-resources` runs `npm run check` (typecheck plus the extension test
      # suite) during its build, and `p` exercises the full wrapper pipeline.
      checks = forEachSystem (
        system:
        let
          inherit (self.packages.${system}) pi-resources p;
        in
        {
          extensions = pi-resources;
          launcher = p;

          # `nix fmt` is only maintainer discipline on its own; this makes the
          # tree format a check. `--no-cache` keeps treefmt from writing to a
          # cache dir inside the sandbox.
          formatting =
            pkgsFor.${system}.runCommand "check-formatting"
              {
                nativeBuildInputs = [ self.formatter.${system} ];
              }
              ''
                cp -r ${self} source
                chmod -R u+w source
                cd source
                treefmt --no-cache --fail-on-change
                touch "$out"
              '';
        }
      );

      devShells = forEachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            name = "pi-wrapped-module";
            packages = [
              self.packages.${system}.p
              self.packages.${system}.pi
              self.packages.${system}.pi-agent-tools
              self.packages.${system}.pi-resources
              self.packages.${system}.pi-fff
              self.packages.${system}.pi-dynamic-workflows
              self.packages.${system}.pi-codex-goal
              self.packages.${system}.pi-mcp-adapter
              self.packages.${system}.pi-review
            ];
          };
        }
      );

      formatter = forEachSystem (system: pkgsFor.${system}.nixfmt-tree);
    };
}
