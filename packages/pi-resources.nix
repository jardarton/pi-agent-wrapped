{ buildNpmPackage }:

buildNpmPackage {
  pname = "pi-wrapped-resources";
  version = "0.1.0";

  src = ../extensions;
  npmDepsHash = "sha256-HxBlNHINQQW7B5BiTXvW+nJ8gleIlayKXoxBItghOYs=";

  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/pi-resources/extensions
    cp -R *.ts explore-helper lib node_modules package.json package-lock.json $out/share/pi-resources/extensions/

    runHook postInstall
  '';
}
