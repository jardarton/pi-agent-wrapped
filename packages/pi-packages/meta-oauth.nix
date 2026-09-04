{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
}:

stdenvNoCC.mkDerivation rec {
  pname = "pi-meta-oauth";
  version = "0.5.0";

  src = fetchFromGitHub {
    owner = "BlockedPath";
    repo = "pi-meta-oauth";
    rev = "ce847e0dbbd1b19d11180966144c1549771ecec8";
    hash = "sha256-VMIDhJFcxKnFqiXa7a3sUGdSTpsHEo4cDmDEB6zwITQ=";
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
