{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
}:

stdenvNoCC.mkDerivation {
  pname = "pi-cliproxyapi-provider";
  version = "1.4.22";

  src = fetchFromGitHub {
    owner = "router-for-me";
    repo = "pi-cliproxyapi-provider";
    rev = "a9730fd6ab58ba98ea176c4bf7e9bb9fee3b316d";
    hash = "sha256-37xRX3EV0lv8/9hjpxpD6xz7sASqKK8Gjwss8WwPoSM=";
  };

  # Upstream tests need its npm dev dependencies (vitest, pinned pi packages); the
  # extension itself only imports Pi's own packages, which Pi provides at runtime.
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/cliproxyapi-provider"
    mkdir -p "$package_dir"
    cp package.json README.md LICENSE "$package_dir/"
    cp -R extensions "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "CLIProxyAPI provider extension for the Pi coding agent";
    homepage = "https://github.com/router-for-me/pi-cliproxyapi-provider";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
