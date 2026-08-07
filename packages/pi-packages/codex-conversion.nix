{
  lib,
  stdenv,
  buildNpmPackage,
  fetchurl,
  autoPatchelfHook,
  alsa-lib,
  openssl,
}:

let
  version = "3.0.9";

  # Upstream is a Bun workspace monorepo with no npm lockfile, and its build
  # needs the TypeScript native preview compiler. The published npm tarball
  # already carries the compiled `dist/` and prebuilt native helpers for every
  # platform, so it is the buildable source here. `codex-conversion/package.json`
  # and `codex-conversion/package-lock.json` cover only the runtime
  # dependencies; `postPatch` substitutes them so `npm ci` neither pulls the dev
  # toolchain nor installs the peer dependencies that Pi itself provides.
  src = fetchurl {
    url = "https://registry.npmjs.org/@howaboua/pi-codex-conversion/-/pi-codex-conversion-${version}.tgz";
    hash = "sha512-8B+HTA7dRKCcKhsQS6i8elr6dnzDFooiwJceXEI2DkRCXoOxopPvj+I2QJSzjD1A5U7bGFSyKNJJSwtiWDuShQ==";
  };

  # Node's `${process.platform}-${process.arch}`, which the extension uses to
  # locate both its own bundled helpers and the code-mode host binary.
  targetDir =
    {
      aarch64-darwin = "darwin-arm64";
      x86_64-darwin = "darwin-x64";
      aarch64-linux = "linux-arm64";
      x86_64-linux = "linux-x64";
    }
    .${stdenv.hostPlatform.system}
      or (throw "Unsupported pi-codex-conversion platform: ${stdenv.hostPlatform.system}");

  # Code Mode needs a host binary that upstream downloads from the Codex release
  # page on first use. Prefetching it keeps the package self-contained, the way
  # every other Pi package here avoids Pi's runtime installer. The digests are
  # upstream's own, and the build asserts them against its asset table so a
  # version bump that moves the release fails instead of silently downloading.
  hostRelease = "rust-v0.145.0";
  hostAssets = {
    darwin-arm64 = {
      name = "codex-code-mode-host-aarch64-apple-darwin.tar.gz";
      sha256 = "75f9306834aa8913b5c1f91ff72f1f6b9441e5a92cd5d64b8e605cf54668460c";
    };
    darwin-x64 = {
      name = "codex-code-mode-host-x86_64-apple-darwin.tar.gz";
      sha256 = "2628a7925ff13704126693a2d964fb6d9433a70f5b10c7a966dad3629b55a939";
    };
    linux-arm64 = {
      name = "codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz";
      sha256 = "22b5862c7206bc944f59402dbab4b4169e381ae8a68f0144a9ba7b61bcf3dd39";
    };
    linux-x64 = {
      name = "codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz";
      sha256 = "ac23177956c30cc1f9f180c27bd80f5bb5b76780db55fb94dcc22644d490852e";
    };
  };
  hostAsset = hostAssets.${targetDir};
  codeModeHost = fetchurl {
    url = "https://github.com/openai/codex/releases/download/${hostRelease}/${hostAsset.name}";
    inherit (hostAsset) sha256;
  };
in

buildNpmPackage {
  pname = "pi-codex-conversion";
  inherit version src;

  sourceRoot = "package";

  npmDepsHash = "sha256-cvRhcE1/ZjByjWiug8Dz0TEKntMp+ZBJ8dIH75PEhQk=";
  npmDepsFetcherVersion = 2;

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  # The bundled helpers are prebuilt glibc binaries: `imagegen` and `web_run`
  # link OpenSSL, `pi-codex-voice` links ALSA, and all of them link libgcc.
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    alsa-lib
    openssl
    stdenv.cc.cc.lib
  ];

  postPatch = ''
    cp package.json upstream-package.json
    cp ${./codex-conversion/package.json} package.json
    cp ${./codex-conversion/package-lock.json} package-lock.json
  '';

  # The only install script in the dependency tree builds tree-sitter-bash's
  # native binding, which this extension never loads: it resolves
  # `tree-sitter-bash/tree-sitter-bash.wasm` and parses through `web-tree-sitter`.
  npmRebuildFlags = [ "--ignore-scripts" ];

  buildPhase = ''
    runHook preBuild

    node ${./codex-conversion/verify-upstream.mjs} \
      ${targetDir} ${hostRelease} ${hostAsset.name} ${hostAsset.sha256}

    # The tarball carries helpers for six platform/architecture pairs, close to
    # 100 MB of them. Only the build target's set can ever run.
    for bin_dir in src/tools/*/bin src/voice/bin; do
      for platform_dir in "$bin_dir"/*; do
        if [ "$(basename "$platform_dir")" != "${targetDir}" ]; then
          rm -r "$platform_dir"
        fi
      done
    done

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/codex-conversion"
    mkdir -p "$package_dir"
    cp package.json README.md CHANGELOG.md LICENSE UPSTREAM_SYNC.md "$package_dir/"
    cp -R dist src node_modules "$package_dir/"

    host_dir="$package_dir/code-mode/bin/${targetDir}"
    mkdir -p "$host_dir"
    tar -xzf ${codeModeHost} -C "$host_dir"
    mv "$host_dir/${lib.removeSuffix ".tar.gz" hostAsset.name}" "$host_dir/codex-code-mode-host"
    chmod +x "$host_dir/codex-code-mode-host"

    runHook postInstall
  '';

  meta = {
    description = "Codex-shaped tools, prompts and OpenAI controls for the Pi coding agent";
    homepage = "https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion";
    license = lib.licenses.mit;
    platforms = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-darwin"
      "x86_64-linux"
    ];
  };
}
