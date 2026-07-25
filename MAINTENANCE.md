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
nix build .#pi-fff
```

Nix will print each expected hash. Replace the fake hashes, then run:

```bash
nix fmt
nix build .#p .#pi-fff
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
nix flake show
nix build .#p
```

Optional sanity check: inspect generated settings and confirm `extensions` contains the Herdr store path ending in `src/integration/assets/pi/herdr-agent-state.ts`.

### Vendored session-reader skill

`skills/session-reader/` is based on <https://github.com/HazAT/pi-config/tree/main/skills/session-reader>, currently from commit `6770b7fbe38823e0932b1315ce6188c91129462a` (the skill's latest upstream change is `ecf52fe6003e37f211cae5c50acba1398886abca`). It is intentionally vendored because wrapped Pi uses `PI_CODING_AGENT_SESSION_DIR` and Pi-relative skill paths rather than `~/.pi/agent/sessions` and `CLAUDE_SKILL_ROOT`.

When refreshing it, preserve those wrapper-specific changes and test the parser against a session under the active profile.

### Matt Pocock skills source

`module.nix` exposes a pinned snapshot of <https://github.com/mattpocock/skills> through `pi.mattPocockSkills.source`. Individual skills are opt-in via `pi.mattPocockSkills.skills`.

The default profile discovers and exposes all `skills/engineering/*` and `skills/in-progress/*` entries from that pinned source. It patches every default Matt Pocock skill with:

- `disable-model-invocation: true`

That keeps them available as manual skill commands without including them in the model-visible skill inventory. `skills/deprecated/*` and `skills/personal/*` are intentionally ignored by default.

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
nix flake show
nix flake check
```

This is the only option in the repository that needs import-from-derivation: the
default `pi.mattPocockSkills.skills` discovers its skill list with `builtins.readDir`
on the fetched source. Nothing else does, so the flag is only required when actually
evaluating a wrapper with the option enabled:

```bash
nix eval --allow-import-from-derivation --impure --raw --expr \
  'let f = builtins.getFlake (toString ./.); in
   (f.wrappers.pi.wrap {
     pkgs = import f.inputs.nixpkgs { system = builtins.currentSystem; };
     pi.mattPocockSkills.enable = true;
   }).drvPath'
```

## Cheap model fallbacks

`extensions/lib/model-selection.ts` contains the shared default cheap-model
and fallback list used by:

- `extensions/explore.ts`
- `extensions/tree-summary-model.ts` for `/tree` summaries
- `extensions/tree-summary-model.ts` for session compaction

The default is OpenAI Codex Terra at low reasoning, followed by GitHub Copilot,
with Claude Haiku as an early cheap fallback. If any of these model ids change
upstream, update the defaults in `extensions/lib/model-selection.ts` and rebuild
`.#pi-resources`.

Wrapper users can also set shared cheap-model env vars declaratively through:

- `pi.cheapModels.primary`
- `pi.cheapModels.fallbacks`


## Pi package

This repo packages Pi directly instead of consuming `numtide/llm-agents.nix` for Pi.

Policy: package the latest upstream `main` commit, not the latest npm release. The npm release can lag behind Pi `main`.

Files:

- `packages/pi/package.nix` — Nix source-build package for the Pi monorepo.
- `packages/pi/default.nix` — small `callPackage` entrypoint.
- `packages/pi/hashes.json` — pinned upstream `main` commit, display version, source hash, and npm dependency hash.
- `packages/pi/generated/` — checked-in generated AI model catalogs used to keep the Nix build network-free.

Consumers in this repo:

- `flake.nix` exposes `packages.${system}.pi` from `./packages/pi`.
- `packages/pi-resources.nix` receives that local Pi package.
- `module.nix` defaults `config.package` to `pkgs.callPackage ./packages/pi { }`.

## Updating Pi to latest main

Always refresh the upstream checkout first:

```sh
# via librarian skill/tool, or equivalent git fetch
# repo: earendil-works/pi
```

Then get the commit and version:

```sh
git -C ~/.cache/checkouts/github.com/earendil-works/pi rev-parse HEAD
git -C ~/.cache/checkouts/github.com/earendil-works/pi describe --tags --always --dirty
jq -r .version ~/.cache/checkouts/github.com/earendil-works/pi/packages/coding-agent/package.json
```

Update `packages/pi/hashes.json`:

```json
{
  "version": "X.Y.Z-main-<shortrev>",
  "rev": "<full upstream main commit>",
  "sourceHash": "sha256-...",
  "npmDepsHash": "sha256-..."
}
```

### 1. Update source hash

Calculate the source hash from the exact commit:

```sh
rev=<full upstream main commit>
nix hash convert --hash-algo sha256 --to sri \
  "$(nix-prefetch-url --unpack https://github.com/earendil-works/pi/archive/$rev.tar.gz)"
```

Copy the result into `sourceHash`.

### 2. Refresh generated model catalogs

The Pi monorepo build generates provider model catalogs by fetching network APIs. Nix builds must not do that, so generate them outside Nix and commit them under `packages/pi/generated/`.

```sh
cd ~/.cache/checkouts/github.com/earendil-works/pi
npm --userconfig /dev/null install --ignore-scripts
cd packages/ai
npm --userconfig /dev/null run generate-models
npm --userconfig /dev/null run generate-image-models
```

Copy generated files into this repo:

```sh
rm -rf packages/pi/generated
mkdir -p packages/pi/generated/providers
cp ~/.cache/checkouts/github.com/earendil-works/pi/packages/ai/src/providers/*.models.ts packages/pi/generated/providers/
cp ~/.cache/checkouts/github.com/earendil-works/pi/packages/ai/src/models.generated.ts packages/pi/generated/
cp ~/.cache/checkouts/github.com/earendil-works/pi/packages/ai/src/image-models.generated.ts packages/pi/generated/
```

### 3. Update npm dependency hash

Set a dummy dependency hash:

```json
"npmDepsHash": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
```

Build:

```sh
nix build .#pi --no-link --builders ''
```

Nix will fail with the expected `npmDepsHash`. Copy the `got:` hash into `packages/pi/hashes.json`.

### 4. Validate

```sh
nix fmt
nix build .#pi --no-link --builders ''
nix build .#p --no-link --builders ''
```

`--builders ''` is useful because remote builders can hang or be slow for this source build.

## Source-build notes

- Latest `main` may not be published to npm yet. Do not depend on the npm tarball for Pi itself.
- `packages/pi/package.nix` builds the monorepo from GitHub source.
- Generated model catalogs are patched into `packages/ai/src` during `postPatch`.
- The build patches scripts from `tsgo` to `tsc` and raises TypeScript target/lib to `ES2024` for Nix compatibility.
- `npmRebuildFlags = [ "--ignore-scripts" ]` avoids native rebuild issues during the offline npm setup phase.
- `packages/pi-resources.nix` warns instead of failing on extension devDependency Pi-version mismatch when the Pi package is a source-built main commit (`piPackage.rev` exists).
- Do not reintroduce the `llm-agents` flake input just for Pi updates.
