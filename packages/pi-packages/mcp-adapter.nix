{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage rec {
  pname = "pi-mcp-adapter";
  version = "2.31.0";

  src = fetchFromGitHub {
    owner = "nicobailon";
    repo = "pi-mcp-adapter";
    rev = "fad5f4c648dc2ba6ec0576fdef6e64d2c7c0368c";
    hash = "sha256-xlp7KBULl90N+ZAumCppsTT78zW0q2o6H3uTHXaLNLk=";
  };

  postPatch = ''
    add_integrity() {
      resolved="https://registry.npmjs.org/@earendil-works/$1/-/$1-0.84.1.tgz"
      substituteInPlace package-lock.json \
        --replace-fail \
          "\"version\": \"0.84.1\","$'\n      '"\"resolved\": \"$resolved\","$'\n      '"\"dev\": true," \
          "\"version\": \"0.84.1\","$'\n      '"\"resolved\": \"$resolved\","$'\n      '"\"integrity\": \"$2\","$'\n      '"\"dev\": true,"
    }
    add_integrity pi-agent-core 'sha512-evyzXYWCLQGmcaBYHlmSku02r8qoN4SGI60GZABo6iV+H+nqX+P9ud8fEZ4GmRq9mUSREvvfX+w9dA9ThF9C6w=='
    add_integrity pi-ai 'sha512-wMsAdJMxuNri08vLqTyYVI201DQQezGhPSTkzYsHdw5dYX3rCNwEmSvpaAwhi7ELKI/2tE/CEgSWg/6iRxSgdQ=='
    add_integrity pi-client 'sha512-/V5hGHE4Zq+jG0GtwIB9PyBUOGd6gBLZ7lkQYFKchKnxYHeH3rmWC5xw4kpnZKKBuBuFTdLVbU9vEjlAGMMb2A=='
    add_integrity pi-protocol 'sha512-Ox1pciyeSPGEEUcxvR0/dJcrY7C6hrEGA8y71rOsvSIUlXN1Cbp/be/eoL71OGDBk5O97TeQPfWN6Ju/2Ehjww=='
    add_integrity pi-telemetry 'sha512-180/xGJtsq7IoR3p9EKWjRd0e9M4DkxInhlo9xyD7prDC7Qrhqq+nhvwrW0lFjPfXcEI2FSHmGCSyvSJE9GsaQ=='
    add_integrity pi-tui 'sha512-udeXFbgEhJ6JiB0uguwNVNkDy2FENfmtQwPcY+/iJ8GWeq18wkal1tKqa5YyeH0IqtX1vG0cGh8zfSYzyzVuLA=='
  '';

  npmDepsHash = "sha256-sZ8vmuoJBa/FQQgGTa+BVEYQC9S5rjzm/4d0ArwMXGY=";
  npmDepsFetcherVersion = 2;

  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --no-save

    package_dir="$out/share/pi-packages/mcp-adapter"
    mkdir -p "$package_dir" "$out/bin"
    cp -R . "$package_dir/"
    rm -rf "$package_dir/__tests__" "$package_dir/examples" "$package_dir/conformance"

    chmod +x "$package_dir/cli.js"
    patchShebangs --build "$package_dir/cli.js"
    ln -s "$package_dir/cli.js" "$out/bin/pi-mcp-adapter"

    runHook postInstall
  '';

  meta = {
    description = "MCP adapter extension for the Pi coding agent";
    homepage = "https://github.com/nicobailon/pi-mcp-adapter";
    license = lib.licenses.mit;
    mainProgram = "pi-mcp-adapter";
  };
}
