{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  fd,
  ripgrep,
}:

let
  versionData = lib.importJSON ./hashes.json;

  source = fetchFromGitHub {
    owner = "earendil-works";
    repo = "pi";
    rev = versionData.rev;
    hash = versionData.sourceHash;
  };
in
buildNpmPackage {
  npmDepsFetcherVersion = 2;
  pname = "pi";
  version = versionData.version;

  src = source;

  postPatch = ''
    patch -p1 < ${./tree-summary-stream-fn.patch}
    cp ${./generated/models.generated.ts} packages/ai/src/models.generated.ts
    cp ${./generated/image-models.generated.ts} packages/ai/src/image-models.generated.ts
    cp ${./generated/providers}/*.models.ts packages/ai/src/providers/
  '';

  preBuild = ''
    node - <<'NODE'
    const fs = require("fs");
    const tsconfigPath = "tsconfig.base.json";
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    tsconfig.compilerOptions.target = "ES2024";
    tsconfig.compilerOptions.lib = ["ES2024"];
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, "\t") + "\n");
    for (const name of ["tui", "ai", "agent", "coding-agent", "orchestrator"]) {
      const path = `packages/''${name}/package.json`;
      const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
      pkg.scripts.build = pkg.scripts.build
        .replace("npm run generate-models && npm run generate-image-models && ", "")
        .replaceAll("tsgo -p", "tsc -p");
      fs.writeFileSync(path, JSON.stringify(pkg, null, "\t") + "\n");
    }
    NODE
  '';

  npmDepsHash = versionData.npmDepsHash;
  makeCacheWritable = true;
  npmBuildScript = "build";
  npmRebuildFlags = [ "--ignore-scripts" ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/node_modules $out/lib/packages $out/bin

    cp -R node_modules/. $out/lib/node_modules/
    cp -R packages/{agent,ai,coding-agent,orchestrator,tui} $out/lib/packages/

    chmod +x $out/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
    ln -s $out/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js $out/bin/pi

    # Only runtime dependencies belong here. Behavioural defaults such as
    # PI_SKIP_VERSION_CHECK and PI_TELEMETRY are set by the wrapper module's
    # `envDefault`, where they stay overridable; a `--set` here would win over the
    # wrapper and make those options unreachable.
    wrapProgram $out/bin/pi \
      --prefix PATH : ${
        lib.makeBinPath [
          fd
          ripgrep
        ]
      }

    runHook postInstall
  '';

  passthru = {
    category = "AI Coding Agents";
    inherit (versionData) rev;
  };

  meta = {
    description = "A terminal-based coding agent with multi-model support";
    homepage = "https://github.com/earendil-works/pi";
    changelog = "https://github.com/earendil-works/pi/releases";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
    mainProgram = "pi";
  };
}
