{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
}:

stdenvNoCC.mkDerivation rec {
  pname = "pi-meta-oauth";
  version = "0.4.2";

  src = fetchFromGitHub {
    owner = "BlockedPath";
    repo = "pi-meta-oauth";
    rev = "d6eccba08d4f9132a1830f3229c0fd5cc11dab3f";
    hash = "sha256-PQ9yEDF167cGvALO7SH1Y4s2BgTiDFcnX4HPUnYU2N0=";
  };

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/meta-oauth"
    mkdir -p "$package_dir"
    cp extensions/meta.ts LICENSE README.md "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "OAuth-only Meta Model API provider extension for Pi";
    homepage = "https://github.com/BlockedPath/pi-meta-oauth";
    license = lib.licenses.mit;
  };
}
