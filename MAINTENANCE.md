# Maintenance

## Pinned upstreams

### FFF Pi package

`packages/pi-packages/fff.nix` builds `@ff-labs/pi-fff` as a Nix Pi resource package instead of using Pi's runtime package loader:

- repo: <https://github.com/dmtrKovalenko/fff>
- extension used: `packages/pi-fff/src/index.ts`
- flake package: `.#pi-fff`
- wrapper option: `pi.resourcePackages`

Update steps:

```bash
rev=$(git ls-remote https://github.com/dmtrKovalenko/fff HEAD | awk '{print $1}')
```

Then update `rev` in `packages/pi-packages/fff.nix`, temporarily replace the source `hash`, `npmDepsHash`, and `cargoDeps.hash` with `lib.fakeHash`, and run:

```bash
nix build .#pi-fff --allow-import-from-derivation
```

Nix will print each expected hash. Replace the fake hashes, then run:

```bash
nix fmt
nix build .#pi .#pi-fff --allow-import-from-derivation
```

Sanity checks:

```bash
node --input-type=module - <<'JS'
import { FileFinder } from './result-1/share/pi-packages/fff/node_modules/@ff-labs/fff-node/dist/src/index.js';
console.log(typeof FileFinder);
JS
```

Launch Pi with a temporary state dir and confirm generated settings has `packages = []` and an FFF extension path under `/nix/store/.../share/pi-packages/fff/src/index.ts`.

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
