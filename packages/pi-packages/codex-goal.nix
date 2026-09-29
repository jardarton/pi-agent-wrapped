{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage rec {
  pname = "pi-package-codex-goal";
  version = "0.4.1";

  src = fetchFromGitHub {
    owner = "fitchmultz";
    repo = "pi-codex-goal";
    rev = "d3cf163992606dbe4e1689b93890053a6ff5988b";
    hash = "sha256-iB5PTicSL4UUf3YUHr9wL7UaPwK1vhH3mG1uC8wupck=";
  };

  npmDepsHash = "sha256-yjmi5lqImtdcslqzE3+BgQdAnpSwWwNOqWNuqlb3XM4=";
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
