{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
}:

stdenvNoCC.mkDerivation rec {
  pname = "pi-meta-oauth";
  version = "0.4.4";

  src = fetchFromGitHub {
    owner = "BlockedPath";
    repo = "pi-meta-oauth";
    rev = "1a4e00778f9d52b6d38f434981fd21cfddfd20a6";
    hash = "sha256-34xDAyv20BFYu6pQCEglwCJut4hoR7rhYKPKlF0JTd4=";
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
