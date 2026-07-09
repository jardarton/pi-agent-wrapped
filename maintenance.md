# Maintenance

## Pi package

This repo packages Pi directly instead of consuming `numtide/llm-agents.nix` for Pi. The local package is in `packages/pi/` and intentionally mirrors the `packages/pi` layout from `numtide/llm-agents.nix`.

Files:

- `packages/pi/package.nix` — Nix package for `@earendil-works/pi-coding-agent`.
- `packages/pi/default.nix` — small `callPackage` entrypoint.
- `packages/pi/hashes.json` — pinned Pi version and Nix hashes.
- `packages/pi/package-lock.json` — lockfile copied into the npm tarball source before `buildNpmPackage` runs.

Consumers in this repo:

- `flake.nix` exposes `packages.${system}.pi` from `./packages/pi`.
- `packages/pi-resources.nix` receives that local Pi package.
- `module.nix` defaults `config.package` to `pkgs.callPackage ./packages/pi { }`.

## Updating Pi

Use npm as the source of truth:

```sh
npm view @earendil-works/pi-coding-agent version dist.tarball --json
```

Then update `packages/pi/hashes.json`:

```json
{
  "version": "X.Y.Z",
  "sourceHash": "sha256-...",
  "npmDepsHash": "sha256-..."
}
```

### 1. Update the source hash

Set the new version and temporarily use a dummy source hash, then build:

```json
"sourceHash": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
```

```sh
nix build .#pi --no-link
```

Nix will fail with the expected hash. Copy that into `packages/pi/hashes.json`.

Alternatively, calculate it directly:

```sh
nix hash convert --hash-algo sha256 --to sri "$(nix-prefetch-url --type sha256 https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-X.Y.Z.tgz)"
```

### 2. Refresh `package-lock.json`

The upstream npm tarball contains `npm-shrinkwrap.json`; this package removes it and supplies `package-lock.json`, following `numtide/llm-agents.nix`.

Manual refresh:

```sh
tmp=$(mktemp -d)
tar -xzf $(nix-prefetch-url https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-X.Y.Z.tgz) -C "$tmp" --strip-components=1
cp "$tmp/npm-shrinkwrap.json" packages/pi/package-lock.json
rm -rf "$tmp"
```

If the tarball layout changes, inspect it first and copy/generate a valid npm lockfile for the package.

### 3. Update the npm dependency hash

Set a dummy dependency hash:

```json
"npmDepsHash": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
```

Build:

```sh
nix build .#pi --no-link
```

Nix will fail with the expected `npmDepsHash`. Copy that into `packages/pi/hashes.json`.

### 4. Validate

```sh
nix fmt
nix build .#pi --no-link
nix build .#p --no-link
```

If remote builders hang while producing `pi-src-with-lock`, force local build for validation:

```sh
nix build .#pi --no-link --builders ''
nix build .#p --no-link --builders ''
```

## Notes

- Keep `packages/pi/package.nix` close to the upstream `numtide/llm-agents.nix/packages/pi/package.nix` implementation.
- The npm package is already built, so `dontNpmBuild = true` is expected.
- `postInstall` wraps `pi` with `fd` and `ripgrep` on `PATH`, and disables Pi version checks and telemetry by default.
- Do not reintroduce the `llm-agents` flake input just for Pi updates.
