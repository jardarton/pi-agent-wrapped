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
    rm -f packages/ai/src/providers/*.models.ts
    cp ${./generated/providers}/*.models.ts packages/ai/src/providers/
    rm -rf packages/ai/src/providers/data
    mkdir packages/ai/src/providers/data
    cp -R ${./generated/provider-data}/. packages/ai/src/providers/data/
  '';

  preBuild = ''
    node - <<'NODE'
    const fs = require("fs");
    const tsconfigPath = "tsconfig.base.json";
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    tsconfig.compilerOptions.target = "ES2024";
    tsconfig.compilerOptions.lib = ["ES2024"];
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, "\t") + "\n");
    for (const name of [
      "tui",
      "telemetry",
      "codemode",
      "mcp",
      "ai",
      "durable",
      "agent",
      "session-backends/sqlite-node",
      "protocol",
      "client",
      "coding-agent",
      "server",
    ]) {
      const path = `packages/''${name}/package.json`;
      const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
      for (const [script, command] of Object.entries(pkg.scripts ?? {})) {
        pkg.scripts[script] = command
          .replace("npm run generate-models && npm run generate-image-models && ", "")
          .replaceAll("tsgo -p", "tsc -p");
      }
      fs.writeFileSync(path, JSON.stringify(pkg, null, "\t") + "\n");
    }
    NODE
  '';

  npmDepsHash = versionData.npmDepsHash;
  makeCacheWritable = true;
  npmBuildScript = "build:offline";
  npmRebuildFlags = [ "--ignore-scripts" ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/node_modules $out/lib/packages/session-backends $out/bin

    cp -R node_modules/. $out/lib/node_modules/
    rm -f $out/lib/node_modules/@earendil-works/pi-evals
    cp -R packages/{agent,ai,chord,client,coding-agent,codemode,durable,mcp,protocol,server,telemetry,tui} $out/lib/packages/
    cp -R packages/session-backends/sqlite-node $out/lib/packages/session-backends/

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
