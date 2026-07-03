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
nix build .#p .#pi-fff --allow-import-from-derivation
```

Sanity checks:

```bash
node --input-type=module - <<'JS'
import { FileFinder } from './result-1/share/pi-packages/fff/node_modules/@ff-labs/fff-node/dist/src/index.js';
console.log(typeof FileFinder);
JS
```

Launch Pi with a temporary state dir and confirm generated settings has `packages = []` and an FFF extension path under `/nix/store/.../share/pi-packages/fff/src/index.ts`.

### Dynamic workflows Pi package

`packages/pi-packages/dynamic-workflows.nix` builds `pi-dynamic-workflows` as a Nix Pi resource package instead of using Pi's runtime package loader:

- repo: <https://github.com/Michaelliv/pi-dynamic-workflows>
- extension used: `extensions/workflow.ts`
- flake package: `.#pi-dynamic-workflows`
- wrapper option: `pi.resourcePackages`

Update steps:

```bash
rev=$(git ls-remote https://github.com/Michaelliv/pi-dynamic-workflows HEAD | awk '{print $1}')
nix flake prefetch --json "github:Michaelliv/pi-dynamic-workflows/$rev"
```

Then update `rev` and source `hash` in `packages/pi-packages/dynamic-workflows.nix`, temporarily replace `npmDepsHash` with `lib.fakeHash`, and run:

```bash
nix build .#pi-dynamic-workflows
```

Nix will print the expected npm dependency hash. Replace the fake hash, then run:

```bash
nix fmt
nix build .#p .#pi-dynamic-workflows
```

The upstream lockfile currently omits integrity fields for three nested `@earendil-works/*` packages. Keep or refresh the `postPatch` integrity substitutions as needed.

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
nix build .#p --allow-import-from-derivation
```

Optional sanity check: inspect generated settings and confirm `extensions` contains the Herdr store path ending in `src/integration/assets/pi/herdr-agent-state.ts`.

### Matt Pocock skills source

`module.nix` exposes a pinned snapshot of <https://github.com/mattpocock/skills> through `pi.mattPocockSkills.source`. Individual skills are opt-in via `pi.mattPocockSkills.skills`.

The default profile exposes selected skills from that pinned source and patches one frontmatter field during packaging:

- `skills/engineering/diagnosing-bugs`
- `skills/engineering/grill-with-docs`
- `skills/engineering/codebase-design`
- `skills/engineering/improve-codebase-architecture`
- `skills/engineering/domain-modeling`
- `skills/productivity/teach`

- `disable-model-invocation: true`

That keeps it available as a manual skill command without including it in the model-visible skill inventory.

Update steps:

```bash
rev=$(git ls-remote https://github.com/mattpocock/skills HEAD | awk '{print $1}')
nix-prefetch-url --unpack "https://github.com/mattpocock/skills/archive/$rev.tar.gz"
```

Convert the printed base32 hash to SRI format:

```bash
nix hash convert --hash-algo sha256 --to sri <base32-hash>
```

Then update `rev` and `hash` in `module.nix`. You normally do not need code changes when adjusting which skills are exposed; configure that in your wrapper/module config via:

- `pi.mattPocockSkills.skills`
- `pi.mattPocockSkills.hiddenSkills`

Afterwards run:

```bash
nix fmt
nix flake show --allow-import-from-derivation
nix build .#pi --allow-import-from-derivation
```

## Cheap model fallbacks

`extensions/model-selection.ts` contains the shared default cheap-model fallback
list used by:

- `extensions/explore.ts`
- `extensions/tree-summary-model.ts` for `/tree` summaries
- `extensions/tree-summary-model.ts` for session compaction

Current defaults prefer OpenAI Codex first, then GitHub Copilot, with Claude
Haiku as an early cheap fallback. If any of these model ids change upstream,
update the defaults in `extensions/model-selection.ts` and rebuild
`.#pi-resources`.

Wrapper users can also set shared cheap-model env vars declaratively through:

- `pi.cheapModels.primary`
- `pi.cheapModels.fallbacks`
