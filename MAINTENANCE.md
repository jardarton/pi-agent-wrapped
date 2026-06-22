# Maintenance

## Pinned upstreams

### Herdr Pi integration

`module.nix` fetches Herdr with a pinned `pkgs.fetchFromGitHub` source for the declarative Pi integration extension:

- repo: <https://github.com/ogulcancelik/herdr>
- file used: `src/integration/assets/pi/herdr-agent-state.ts`
- option: `pi.herdrIntegration.source`

Refresh regularly so the bundled integration stays compatible with current Herdr releases.

Update steps:

```bash
rev=$(git ls-remote https://github.com/ogulcancelik/herdr HEAD | awk '{print $1}')
nix-prefetch-url --unpack "https://github.com/ogulcancelik/herdr/archive/$rev.tar.gz"
```

Convert the printed base32 hash to SRI format:

```bash
nix hash convert --hash-algo sha256 --to sri <base32-hash>
```

Then update `rev` and `hash` in `module.nix`, run:

```bash
nix fmt
nix flake show --allow-import-from-derivation
nix build .#pi --allow-import-from-derivation
```

Optional sanity check: inspect generated settings and confirm `extensions` contains the Herdr store path ending in `src/integration/assets/pi/herdr-agent-state.ts`.
