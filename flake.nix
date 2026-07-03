{
  description = "Declarative Pi coding-agent setup packaged with nix-wrapper-modules";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-wrapper-modules.url = "github:BirdeeHub/nix-wrapper-modules";
    nix-wrapper-modules.inputs.nixpkgs.follows = "nixpkgs";

    llm-agents.url = "github:numtide/llm-agents.nix";
    llm-agents.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      nix-wrapper-modules,
      ...
    }@inputs:
    let
      lib = nixpkgs.lib;
      systems = lib.systems.flakeExposed;
      forEachSystem = lib.genAttrs systems;
      wrapperModule = lib.modules.importApply ./module.nix inputs;
      wrapper = nix-wrapper-modules.lib.evalModule wrapperModule;
    in
    {
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
          pkgs = import nixpkgs { inherit system; };
        in
        rec {
          pi-agent-tools = pkgs.callPackage ./packages/pi-agent-tools.nix { };
          pi-resources = pkgs.callPackage ./packages/pi-resources.nix { };
          pi-fff = pkgs.callPackage ./packages/pi-packages/fff.nix { };
          pi-dynamic-workflows = pkgs.callPackage ./packages/pi-packages/dynamic-workflows.nix { };
          pi-wrapped = self.wrappers.pi.wrap { inherit pkgs; };
          p = pkgs.runCommand "pi-wrapped-p-only" { } ''
            mkdir -p $out/bin
            ln -s ${pi-wrapped}/bin/p $out/bin/p
          '';
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

      homeModules = {
        pi = self.nixosModules.pi;
        default = self.homeModules.pi;
      };

      devShells = forEachSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            name = "pi-wrapped-module";
            packages = [
              self.packages.${system}.p
              self.packages.${system}.pi-agent-tools
              self.packages.${system}.pi-resources
              self.packages.${system}.pi-fff
              self.packages.${system}.pi-dynamic-workflows
            ];
          };
        }
      );

      formatter = forEachSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        pkgs.writeShellApplication {
          name = "fmt";
          runtimeInputs = [ pkgs.nixfmt ];
          text = ''
            nixfmt flake.nix module.nix packages/pi-agent-tools.nix packages/pi-resources.nix packages/pi-packages/fff.nix packages/pi-packages/dynamic-workflows.nix "$@"
          '';
        }
      );
    };
}
