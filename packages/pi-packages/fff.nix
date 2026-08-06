{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  rustPlatform,
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
    rev = "3a0ce85c54875563bc55888b6b9829b44aeca911";
    hash = "sha256-OsuHYxz1dvyfMXiqKGBGsSt5+wFCaCgGxO7T4S0YjHc=";
  };

  npmDepsHash = "sha256-9bDNsPKZILm4dc+2z69xu9nnE07uJUHXcOv20HBb1Ow=";
  npmDepsFetcherVersion = 2;

  cargoDeps = rustPlatform.fetchCargoVendor {
    inherit src;
    hash = "sha256-2EmPI6x55hGeNSrA/cvb+e4Tku81C6+tgc7pAjv0zYM=";
  };

  postPatch = ''
    for file in packages/fff-node/package.json packages/fff-bun/package.json; do
      substituteInPlace "$file" \
        --replace-fail \
          $'    "@ff-labs/fff-bin-win32-arm64": "0.0.0",\n    "@ff-labs/fff-bin-android-arm64": "0.0.0"' \
          $'    "@ff-labs/fff-bin-win32-arm64": "0.0.0"'
    done
    substituteInPlace package-lock.json \
      --replace-warn $'        "@ff-labs/fff-bin-android-arm64": "0.0.0",\n' ""
  '';

  nativeBuildInputs = [
    rustPlatform.cargoSetupHook
    cargo
    rustc
  ];

  buildPhase = ''
    runHook preBuild
    npm run --workspace packages/fff-node build
    cargo build --release --package fff-c
    mkdir -p packages/fff-node/bin
    cp target/release/libfff_c.* packages/fff-node/bin/
    npm prune --omit=dev --no-save --workspace packages/pi-fff
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
