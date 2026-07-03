{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage rec {
  pname = "pi-package-dynamic-workflows";
  version = "1.0.1";

  src = fetchFromGitHub {
    owner = "Michaelliv";
    repo = "pi-dynamic-workflows";
    rev = "31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2";
    hash = "sha256-NSFbcWnYETmKbx3tfSVVdyXJXnxQChiFcAjuK+FZVGs=";
  };

  postPatch = ''
    substituteInPlace package-lock.json \
      --replace-fail '"resolved": "https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.78.0.tgz",' '"resolved": "https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.78.0.tgz",
      "integrity": "sha512-xhWd59Qzd8yO88gYQw2S4dEQstJJEiUtxRP01//YzVJ61jCtUASMfcyAmYhgGYR4Onp7GmwEAbBBGOiV6Iwk9g==",' \
      --replace-fail '"resolved": "https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.78.0.tgz",' '"resolved": "https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.78.0.tgz",
      "integrity": "sha512-q0hUrvT6ngT6cgBX0oIbzfQfmzztgdkZobP8OTL+sCOOBlnG6+1YRt8g7zO9CC/4NdeYEqa7uGqWdQhH0fjCLA==",' \
      --replace-fail '"resolved": "https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.78.0.tgz",' '"resolved": "https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.78.0.tgz",
      "integrity": "sha512-3a705FnsVVUhAyceShNB3kS2rpxcxLcx+hqB0u6MMMpHwQGbW+m++MqA6r7eOzq/8FLx5e3vDh38h/SVTk2qzw==",'
  '';

  npmDepsHash = "sha256-bseGaz2Pp3RtssfKNugzdjc1SHzqMUM5CtNR9plh4R4=";
  npmDepsFetcherVersion = 2;

  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/dynamic-workflows"
    mkdir -p "$package_dir"

    cp package.json README.md "$package_dir/"
    cp -R dist extensions src types node_modules "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "Claude-Code-style dynamic workflow orchestration for Pi";
    homepage = "https://github.com/Michaelliv/pi-dynamic-workflows";
    license = lib.licenses.mit;
  };
}
