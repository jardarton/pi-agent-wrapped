{
  buildNpmPackage,
  lib,
  piPackage,
}:

buildNpmPackage {
  pname = "pi-wrapped-resources";
  version = "0.1.0";

  src = ../extensions;
  npmDepsHash = "sha256-xPeT+7MJD3S76hr8g8TQuewgOesGrVfS/3/S2ahiRRI=";
  npmDepsFetcherVersion = 2;

  buildPhase = ''
    runHook preBuild

    runtime_pi_version=$(node -p "require('${piPackage}/lib/node_modules/@earendil-works/pi-coding-agent/package.json').version")
    declared_pi_version=$(node -p "require('./package.json').devDependencies['@earendil-works/pi-coding-agent']")
    if [ "$declared_pi_version" != "$runtime_pi_version" ]; then
      ${
        if piPackage ? rev then
          ''
            echo "warning: extensions/package.json @earendil-works/pi-coding-agent version ($declared_pi_version) does not match source-built Pi version ($runtime_pi_version)" >&2
          ''
        else
          ''
            echo "extensions/package.json @earendil-works/pi-coding-agent version ($declared_pi_version) does not match runtime Pi version ($runtime_pi_version)" >&2
            exit 1
          ''
      }
    fi

    npm run check
    npm prune --omit=dev

    if [ -e node_modules/@earendil-works/pi-coding-agent ] || [ -e node_modules/@earendil-works/pi-ai ] || [ -e node_modules/@earendil-works/pi-tui ]; then
      echo "Pi runtime packages must not be vendored into extension resources" >&2
      exit 1
    fi

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/pi-resources/extensions
    cp -R *.ts THIRD_PARTY_NOTICES.md explore-helper lib node_modules package.json package-lock.json $out/share/pi-resources/extensions/

    runHook postInstall
  '';
}
