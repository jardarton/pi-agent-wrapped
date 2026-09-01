{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
  nodejs_22,
}:

stdenvNoCC.mkDerivation rec {
  pname = "pi-clarify";
  version = "1.0.1";

  src = fetchFromGitHub {
    owner = "dodo-reach";
    repo = "pi-clarify";
    rev = "aa2a7a1fa3446cd2700fcd68e10158b2809b10ac";
    hash = "sha256-LS4oNBgKGZoHwNybrUxCKCYGdsqnPzZrS+niE1XXQu8=";
  };

  nativeCheckInputs = [ nodejs_22 ];

  dontBuild = true;
  doCheck = true;

  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/clarify"
    mkdir -p "$package_dir"
    cp package.json README.md LICENSE "$package_dir/"
    cp -R extensions src "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "Prompt clarification extension for the Pi coding agent";
    homepage = "https://github.com/dodo-reach/pi-clarify";
    license = lib.licenses.mit;
    platforms = nodejs_22.meta.platforms;
  };
}
