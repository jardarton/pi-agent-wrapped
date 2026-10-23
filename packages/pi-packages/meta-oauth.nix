{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
}:

stdenvNoCC.mkDerivation rec {
  pname = "pi-meta-oauth";
  version = "0.7.3";

  src = fetchFromGitHub {
    owner = "BlockedPath";
    repo = "pi-meta-oauth";
    rev = "3319e2f3b9d9f5441f3dfe121345298952a1ec6b";
    hash = "sha256-enr10wGC4qNCuqrUvlBGL2xZdWl+OBm2SAeVWuqodBI=";
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
