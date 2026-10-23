{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage rec {
  pname = "pi-package-codex-goal";
  version = "0.6.1";

  src = fetchFromGitHub {
    owner = "fitchmultz";
    repo = "pi-codex-goal";
    rev = "ffea8e68fb831c6b218f300a1c6818b09f2e168f";
    hash = "sha256-q5AdREXLclY+kNzyVSTI7MknfPva8Bsc0oiDwS9csqQ=";
  };

  # Keep active continuation history append-only; retain upstream stale-work guards.
  # The patch includes regression tests run by the upstream test suite below.
  patches = [ ./codex-goal/continuation-cache.patch ];

  npmDepsHash = "sha256-BLsTsVgzRa98aaYIWkuq3wuW11sGfOcj3yKlmCfRdIU=";
  npmDepsFetcherVersion = 2;

  buildPhase = ''
    runHook preBuild
    npm run typecheck
    npm test
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/codex-goal"
    mkdir -p "$package_dir"
    cp package.json README.md CHANGELOG.md LICENSE "$package_dir/"
    cp -R extensions src prompts "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "Codex-style goal tracking and continuation for Pi";
    homepage = "https://github.com/fitchmultz/pi-codex-goal";
    license = lib.licenses.mit;
  };
}
