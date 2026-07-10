{
  lib,
  buildNpmPackage,
  src,
}:

buildNpmPackage {
  pname = "pi-herdr-subagents";
  version = "0.2.0";

  inherit src;

  postPatch = ''
    substituteInPlace package-lock.json \
      --replace-fail \
        $'"resolved": "https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.80.3.tgz",\n      "dev": true,' \
        $'"resolved": "https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.80.3.tgz",\n      "integrity": "sha512-3qw0/GeRQBU/nlGjDe5Yb7ePKTmoxefx2YxyKMFAviFUMXpFexBG/hS7mBtwFahFvzrrTPPoRT6sFIDjwoDWPQ==",\n      "dev": true,' \
      --replace-fail \
        $'"resolved": "https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.80.3.tgz",\n      "dev": true,' \
        $'"resolved": "https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.80.3.tgz",\n      "integrity": "sha512-jPZLMeGL5kkMSEAwAklfXTMHqZvfhsJtCCpKGIr5Duk7mc0n4skjB1dugk7y0z3z8ZHIUCmPAWHdyDqgUz5vdA==",\n      "dev": true,' \
      --replace-fail \
        $'"resolved": "https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.80.3.tgz",\n      "dev": true,' \
        $'"resolved": "https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.80.3.tgz",\n      "integrity": "sha512-2BJI6qwRQfnM0Q7seL1+SbacU/jRRjBnN7Hu3n9BjAn7/s5FaBNnvdD1qBQYRsFTHfjqMaDsjYqanPyqwXj99w==",\n      "dev": true,'
  '';

  npmDepsHash = "sha256-L4Vqyimc5/awqQoDxLQtZTosuluaduCpwpTuw82nwHU=";
  npmDepsFetcherVersion = 2;

  buildPhase = ''
    runHook preBuild
    npm run check
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/pi-herdr-subagents"
    mkdir -p "$package_dir"
    cp package.json README.md LICENSE "$package_dir/"
    cp -R src skills docs "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "Herdr-native one-shot command supervision for persistent Pi parents";
    homepage = "https://github.com/jardarton/pi-herdr-subagents";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
}
