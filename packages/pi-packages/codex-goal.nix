{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage rec {
  pname = "pi-package-codex-goal";
  version = "0.2.0";

  src = fetchFromGitHub {
    owner = "fitchmultz";
    repo = "pi-codex-goal";
    rev = "529eb81ccd45396a4a042bfa92f160e3ee2d5591";
    hash = "sha256-F/I3tlCYiNB+VrvVymoBQdbfZxMZcvqp1/ymZPRwVgM=";
  };

  postPatch = ''
    add_integrity() {
      resolved="https://registry.npmjs.org/@earendil-works/$1/-/$1-0.84.0.tgz"
      substituteInPlace package-lock.json \
        --replace-fail \
          "\"version\": \"0.84.0\","$'\n      '"\"resolved\": \"$resolved\","$'\n      '"\"dev\": true," \
          "\"version\": \"0.84.0\","$'\n      '"\"resolved\": \"$resolved\","$'\n      '"\"integrity\": \"$2\","$'\n      '"\"dev\": true,"
    }
    add_integrity pi-agent-core 'sha512-L1lw0lwR5LXCzGEeHD9XNEruU2bg0H8clOA8ySdGMHvxutp8GC+yZL6MZp4tqQRnLKP3gHmY7TrWzQ3YnFdJYQ=='
    add_integrity pi-ai 'sha512-N9RDk8q0eglGiy+NqTZ3Ev2j+6oFNXSAJa8b0CYhvWB9HGiKZjsoCESXkUvMDLybrn0wXp75sdsoBzEtHxk9kA=='
    add_integrity pi-client 'sha512-fHXgw1FdLDh+uw42SvTkJRBfgc3nsrslghvbRFEAxdjfcOxJt7hPsTj4HHNK96wMy1f+zvQYL8Y2znvFoZ8JDA=='
    add_integrity pi-protocol 'sha512-Fc28cCYGg5+aRnMzbAD7QAi6Xl//kbETyFroLHCs3Zf4oaXH9L2gzBqVLVAwrKIKeS0uffUrmihocGTECfKW6Q=='
    add_integrity pi-telemetry 'sha512-g6hLxEfAUk3zJlDmFWhWHJNcYXYiNGeWuJC9YkcHpkdkj0gxD4uaMNNNU3QsAEJXW9Qcxnl21+U8GfhVsc8C5g=='
    add_integrity pi-tui 'sha512-nbs0FeZJ5rWDD6VpKfXXmYbEHnHqb40V9glE2l9f8ftoWpsP8nw0WcXK8jOjfRsDPnT9dJHy3dItOHdn/AFGjA=='
  '';

  npmDepsHash = "sha256-eHcGpDRRSa9Iq4crkpIflIGImMexMCj1MaQFEos3or0=";
  npmDepsFetcherVersion = 2;

  buildPhase = ''
    runHook preBuild
    npm run typecheck
    npm test
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/share/pi-packages/codex-goal"
    mkdir -p "$package_dir"
    cp package.json README.md CHANGELOG.md LICENSE "$package_dir/"
    cp -R src prompts "$package_dir/"

    runHook postInstall
  '';

  meta = {
    description = "Codex-style goal tracking and continuation for Pi";
    homepage = "https://github.com/fitchmultz/pi-codex-goal";
    license = lib.licenses.mit;
  };
}
