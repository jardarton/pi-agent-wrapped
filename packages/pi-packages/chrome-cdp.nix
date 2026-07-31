{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
  nodejs_22,
}:

stdenvNoCC.mkDerivation rec {
  pname = "pi-chrome-cdp";
  version = "1.1.0";

  src = fetchFromGitHub {
    owner = "pasky";
    repo = "chrome-cdp-skill";
    rev = "ffea76a24b0471663ddd9d9f24335bbc442b6266";
    hash = "sha256-7IVsLdA3XkHhGDSAvsMpKeALDSmwfsUGYJlfcXDRusA=";
  };

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/chrome-cdp"
    mkdir -p "$package_dir"
    cp package.json README.md LICENSE "$package_dir/"
    cp -R skills "$package_dir/skills"
    substituteInPlace "$package_dir/skills/chrome-cdp/scripts/cdp.mjs" \
      --replace-fail '#!/usr/bin/env node' '#!${lib.getExe nodejs_22}'

    runHook postInstall
  '';

  meta = {
    description = "Pi skill for interacting with a live Chrome session over CDP";
    homepage = "https://github.com/pasky/chrome-cdp-skill";
    license = lib.licenses.mit;
    platforms = nodejs_22.meta.platforms;
  };
}
