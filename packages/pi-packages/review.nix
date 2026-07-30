{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage rec {
  pname = "pi-review";
  version = "0.1.0";

  src = fetchFromGitHub {
    owner = "earendil-works";
    repo = "pi-review";
    rev = "f1de050504936046c0f85b21fec0e0a93ef394eb";
    hash = "sha256-bvdJjLudTd9YQF8ip30jIvi6MY3MAcw5GXVONx1DLuQ=";
  };

  npmDepsHash = "sha256-kq54f96XFxHtaCV8CEy2UvhYYc5e2Db08h8fbrDW3VI=";
  npmDepsFetcherVersion = 2;

  buildPhase = ''
    runHook preBuild
    npm run typecheck
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/pi-review"
    mkdir -p "$package_dir"
    cp package.json README.md LICENSE review.ts "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "Code review workflow extension for the Pi coding agent";
    homepage = "https://github.com/earendil-works/pi-review";
    license = lib.licenses.mit;
  };
}
