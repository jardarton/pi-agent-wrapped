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
    rev = "4dd69f03e7e8ff77502aecc33e6798af93f6da0a";
    hash = "sha256-6Whi1NNyuef22075T3cNkZDKMK3SxbS6VKTnBzdbwes=";
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
