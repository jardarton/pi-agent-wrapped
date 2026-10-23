{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
  nodejs,
  piPackage,
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
    cp package.json LICENSE README.md "$package_dir/"
    cp -R extensions src "$package_dir/"

    runHook postInstall
  '';

  doInstallCheck = true;
  nativeInstallCheckInputs = [ nodejs ];
  installCheckPhase = ''
    runHook preInstallCheck
    export HOME=$(mktemp -d)
    export XDG_CACHE_HOME="$HOME/.cache"
    META_OAUTH_PACKAGE_DIR="$out/share/pi-packages/meta-oauth" \
      PI_PACKAGE_DIR="${piPackage}/lib/node_modules/@earendil-works/pi-coding-agent" \
      node --test ${./meta-oauth-load.test.mjs}
    runHook postInstallCheck
  '';

  meta = {
    description = "OAuth-only Meta Model API provider extension for Pi";
    homepage = "https://github.com/BlockedPath/pi-meta-oauth";
    license = lib.licenses.mit;
  };
}
