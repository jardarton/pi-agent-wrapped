{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
}:

stdenvNoCC.mkDerivation {
  pname = "pi-cliproxyapi-provider";
  version = "1.4.23";

  src = fetchFromGitHub {
    owner = "router-for-me";
    repo = "pi-cliproxyapi-provider";
    rev = "79b56b5a9dcb8b859cbf9392465ad707b88dfd56";
    hash = "sha256-PsmXW3yCr9zIDGpxsDz3nDfqE8NQPqEZNifbEo9GQCI=";
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
