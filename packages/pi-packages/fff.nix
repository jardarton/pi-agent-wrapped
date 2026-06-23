{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  rustPlatform,
  cargo,
  rustc,
}:

buildNpmPackage rec {
  pname = "pi-package-fff";
  version = "0.6.0";

  src = fetchFromGitHub {
    owner = "dmtrKovalenko";
    repo = "fff";
    rev = "957f222da76f120868defdf9e7204309c3800e5e";
    hash = "sha256-d6giBeVeWohpkLzOUDSya5l9zIciWNWlUCmmJsLUj+I=";
  };

  npmDepsHash = "sha256-pxpTm252ZSu+E5JeJvUkljbMuwE7trnyX4d7/1ZWh9U=";
  npmDepsFetcherVersion = 2;

  cargoDeps = rustPlatform.fetchCargoVendor {
    inherit src;
    hash = "sha256-nHVQccbKSfX9fZXh0aPRP33n4nHWhaRdz9k49apULME=";
  };

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

    runHook postInstall
  '';

  meta = {
    description = "Pi package for FFF-powered fuzzy file and content search";
    homepage = "https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff";
    license = lib.licenses.mit;
  };
}
