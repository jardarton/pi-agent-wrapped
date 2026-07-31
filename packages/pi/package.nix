{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  fd,
  ripgrep,
  perl,
  # Splash text substitutions, or null to leave Pi's own splash untouched.
  #
  # This has to happen inside the package build: the launcher execs
  # `${pi}/bin/pi`, and Node resolves the interactive-mode module from that
  # script's realpath, so patching a copy in the wrapper output has no effect on
  # what actually runs.
  #
  # Expects { logoText, versionText, compactHelpText, helpText }, each already
  # JSON-encoded (versionText may be the JSON literal `null` to hide it).
  splashPatch ? null,
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
    mkdir -p packages/ai/src/providers/data
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
      "ai",
      "agent",
      "storage/sqlite-node",
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

    mkdir -p $out/lib/node_modules $out/lib/packages/storage $out/bin

    cp -R node_modules/. $out/lib/node_modules/
    rm -f $out/lib/node_modules/@earendil-works/pi-evals
    cp -R packages/{agent,ai,client,coding-agent,protocol,server,tui} $out/lib/packages/
    cp -R packages/storage/sqlite-node $out/lib/packages/storage/

    ${lib.optionalString (splashPatch != null) ''
      interactive_mode="$out/lib/packages/coding-agent/dist/modes/interactive/interactive-mode.js"
      if [ ! -f "$interactive_mode" ]; then
        echo "pi splash patch: interactive-mode.js not found at expected path; upstream layout changed" >&2
        exit 1
      fi
      splash_require() {
        grep -qF -e "$1" "$interactive_mode" || {
          echo "pi splash patch: marker for $2 not found; upstream source changed" >&2
          exit 1
        }
      }
      splash_forbid() {
        if grep -qF -e "$1" "$interactive_mode"; then
          echo "pi splash patch: substitution for $2 did not apply" >&2
          exit 1
        fi
      }
      splash_require 'theme.fg("accent", APP_NAME)' "splash logo"
      splash_require 'Press ''${keyText("app.tools.expand")} to show full startup help' "compact splash help"
      splash_require 'theme.fg("dim", `Pi can explain its own features' "splash help"
      SPLASH_LOGO_TEXT=${lib.escapeShellArg splashPatch.logoText} \
      SPLASH_VERSION_TEXT=${lib.escapeShellArg splashPatch.versionText} \
        ${perl}/bin/perl -0pi -e 's/const logo = theme\.bold\(theme\.fg\("accent", APP_NAME\)\) \+ theme\.fg\("dim", ` v\$\{this\.version\}`\);/const logo = theme.bold(theme.fg("accent", $ENV{SPLASH_LOGO_TEXT})) + ($ENV{SPLASH_VERSION_TEXT} === "null" ? "" : theme.fg("dim", $ENV{SPLASH_VERSION_TEXT}.replace("{version}", this.version)));/' "$interactive_mode"
      SPLASH_COMPACT_HELP_TEXT=${lib.escapeShellArg splashPatch.compactHelpText} \
        ${perl}/bin/perl -0pi -e 's/const compactOnboarding = theme\.fg\("dim", `Press \$\{keyText\("app\.tools\.expand"\)\} to show full startup help and loaded resources\.`\);/const compactOnboarding = theme.fg("dim", $ENV{SPLASH_COMPACT_HELP_TEXT}.replace("{expandKey}", keyText("app.tools.expand")));/' "$interactive_mode"
      SPLASH_HELP_TEXT=${lib.escapeShellArg splashPatch.helpText} \
        ${perl}/bin/perl -0pi -e 's/const onboarding = theme\.fg\("dim", `Pi can explain its own features and look up its docs\. Ask it how to use or extend Pi\.`\);/const onboarding = theme.fg("dim", $ENV{SPLASH_HELP_TEXT});/' "$interactive_mode"
      splash_forbid 'theme.fg("accent", APP_NAME)' "splash logo"
      splash_forbid 'Press ''${keyText("app.tools.expand")} to show full startup help' "compact splash help"
      splash_forbid 'theme.fg("dim", `Pi can explain its own features' "splash help"
    ''}

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
