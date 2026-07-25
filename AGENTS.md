# Agent instructions

## Reference
<https://github.com/earendil-works/pi>
<https://github.com/BirdeeHub/nix-wrapper-modules>

## Pi-native child processes

See [docs/pi-native-children.md](docs/pi-native-children.md). That file is the single
source for this invariant: `module.nix` reads it verbatim into every profile's
generated `AGENTS.md`, so it applies both when working in this repository and when
running under a wrapped Pi. Edit it there, not here.

## Generic package boundary

This repository is a generic public Pi wrapper. Keep all defaults neutral: no personal models, themes, keybindings, skills, prompts, named profiles, endpoints, secrets, or third-party integrations enabled by default.

Reusable capabilities belong here: wrapper options, package builders, bundled resources, integrations, `lib.mkProfile`, and the generic multi-profile Home Manager module. Concrete profiles and personal presets belong in the consumer repository.

All default flake aliases must remain generic. Neutral examples and test fixtures are allowed, but do not export them as opinionated named profiles.

## Pi profile packaging model

Profiles must be independently evaluated and installable. `lib.mkProfile` is the package boundary: it accepts downstream wrapper modules and produces a launcher-only package so multiple profiles do not collide on Pi's underlying binaries.

`homeModules.pi` maps arbitrary `programs.piWrapped.profiles` entries through that factory. Keep the profile option generic; use deferred wrapper modules instead of duplicating the `pi.*` option schema in the Home Manager module.

Profiles may expose aliases, but launcher names and mutable `profileName` values must be unique. An optional profile must never mutate or replace another profile.

Example consumer shape:

```nix
imports = [ inputs.pi-agent-wrapped.homeModules.pi ];

programs.piWrapped = {
  enable = true;
  sharedModules = [ ./pi/base.nix ];
  profiles.main = {
    profileName = "default";
    binName = "p";
    aliases = [ "pi" ];
    modules = [ ./pi/main.nix ];
  };
};
```
