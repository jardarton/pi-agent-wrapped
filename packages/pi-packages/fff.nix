{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  rustPlatform,
  bun,
  cargo,
  rustc,
  stdenv,
}:

let
  platformPackage =
    {
      aarch64-darwin = "fff-bin-darwin-arm64";
      x86_64-darwin = "fff-bin-darwin-x64";
      aarch64-linux = "fff-bin-linux-arm64-gnu";
      x86_64-linux = "fff-bin-linux-x64-gnu";
    }
    .${stdenv.hostPlatform.system} or (throw "Unsupported fff platform: ${stdenv.hostPlatform.system}");

  libFilename = if stdenv.hostPlatform.isDarwin then "libfff_c.dylib" else "libfff_c.so";
in

buildNpmPackage rec {
  pname = "pi-package-fff";
  version = "0.6.0";

  src = fetchFromGitHub {
    owner = "dmtrKovalenko";
    repo = "fff";
    rev = "95fd777c2529fc7b4d7572dabff64cc07268f2c5";
    hash = "sha256-GSjvvdLkuezFUrHqiSeePa64VRb3tabOKZNqEE5XSAw=";
  };

  npmDepsHash = "sha256-losBFW25iAkYaYkmjcob5ACUudyHSQk19cJyv+zqUKY=";
  npmDepsFetcherVersion = 2;
  npmFlags = [ "--legacy-peer-deps" ];

  cargoDeps = rustPlatform.fetchCargoVendor {
    inherit src;
    hash = "sha256-VKI7MnqCGis78qmYuBkViT96ZhG4Wy9vARdnmGV048A=";
  };

  postPatch = ''
      cp ${./fff-package-lock.json} package-lock.json
      substituteInPlace package.json \
        --replace-fail \
          '  "private": true,' \
          '  "private": true,
    "dependencies": { "@sinclair/typebox": "0.34.52" },
    "workspaces": ["packages/fff-bun", "packages/fff-node", "packages/pi-fff"],'

      # Bun bakes its build-time __dirname into fff-node's ESM bundle, making
      # runtime library lookup start under /build/source. Anchor lookup to the
      # immutable Nix package and prefer its bundled native library.
      package_dir="$out/share/pi-packages/fff/node_modules/@ff-labs/fff-node"
      get_current_dir="function getCurrentDir(): string {
        return \"$package_dir\";
      }"
      substituteInPlace packages/fff-node/src/binary.ts \
        --replace-fail \
          $'function getCurrentDir(): string {\n  // CJS build: import.meta.url is inlined at bundle time, __dirname is the truth\n  if (typeof __dirname !== "undefined") return __dirname;\n\n  const url = import.meta.url;\n\n  if (url.startsWith("file://")) {\n    return dirname(fileURLToPath(url));\n  }\n  return dirname(url);\n}' \
          "$get_current_dir"
      substituteInPlace packages/fff-node/src/binary.ts \
        --replace-fail \
          $'export function findBinary(): string | null {\n  if (isDevWorkspace()) {' \
          $'export function findBinary(): string | null {\n  const bundledPath = join(getPackageDir(), "bin", getLibFilename());\n  if (existsSync(bundledPath)) return bundledPath;\n\n  if (isDevWorkspace()) {'
  '';

  nativeBuildInputs = [
    rustPlatform.cargoSetupHook
    bun
    cargo
    rustc
  ];

  buildPhase = ''
    runHook preBuild
    npm run --workspace packages/fff-node build
    cargo build --release --package fff-c
    mkdir -p packages/fff-node/bin
    cp target/release/libfff_c.* packages/fff-node/bin/
    npm prune --omit=dev --no-save --legacy-peer-deps --workspace packages/pi-fff
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/fff"
    mkdir -p \
      "$package_dir/node_modules/@ff-labs" \
      "$package_dir/node_modules/@sinclair"

    cp packages/pi-fff/package.json "$package_dir/package.json"
    cp -R packages/pi-fff/src "$package_dir/src"
    cp -R node_modules/ffi-rs "$package_dir/node_modules/ffi-rs"
    cp -R node_modules/@yuuang "$package_dir/node_modules/@yuuang"
    cp -R node_modules/@sinclair/typebox "$package_dir/node_modules/@sinclair/typebox"
    cp -R packages/fff-node "$package_dir/node_modules/@ff-labs/fff-node"
    rm -rf "$package_dir/node_modules/@ff-labs/fff-node/node_modules"

    platform_dir="$package_dir/node_modules/@ff-labs/${platformPackage}"
    mkdir -p "$platform_dir"
    cp "target/release/${libFilename}" "$platform_dir/${libFilename}"
    cat > "$platform_dir/package.json" <<'EOF'
    {
      "name": "@ff-labs/${platformPackage}",
      "version": "${version}",
      "private": true
    }
    EOF

    runHook postInstall
  '';

  meta = {
    description = "Pi package for FFF-powered fuzzy file and content search";
    homepage = "https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff";
    license = lib.licenses.mit;
  };
}
