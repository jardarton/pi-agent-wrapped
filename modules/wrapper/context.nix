{
  config,
  lib,
  pkgs,
  wlib,
}:
let
  jsonFmtType = wlib.types.structuredValueWith { typeName = "JSON"; };
  localSkillsDir = pkgs.runCommand "pi-wrapped-skills" { } ''
    mkdir -p "$out"
    ${lib.concatMapStringsSep "\n" (skill: ''
      mkdir -p "$out/$(dirname ${lib.escapeShellArg skill})"
      cp -R ${../../skills}/${skill} "$out/${lib.escapeShellArg skill}"
    '') config.pi.localSkills}
    chmod -R u+w "$out"
    ${lib.optionalString (config.pi.librarian.mode == "tool") ''
      rm -rf "$out/librarian"
    ''}
  '';
  resourceDirs = {
    skills = localSkillsDir;
    prompts = ../../prompts;
    themes = ../../themes;
    extensions = ../../extensions;
  };
  piPackages = import ../../packages {
    inherit pkgs;
    piPackage = config.package;
  };
  agentTools = piPackages.pi-agent-tools;
  piResources = piPackages.pi-resources;
  fffPackage = piPackages.pi-fff;
  dynamicWorkflowsPackage = piPackages.pi-dynamic-workflows;
  codexGoalPackage = piPackages.pi-codex-goal;
  mcpAdapterPackage = piPackages.pi-mcp-adapter;
  reviewPackage = piPackages.pi-review;
  clarifyPackage = piPackages.pi-clarify;
  metaOAuthPackage = piPackages.pi-meta-oauth;
  chromeCdpPackage = piPackages.pi-chrome-cdp;
  codexConversionPackage = piPackages.pi-codex-conversion;
  bundledExtensionPath = name: "${piResources}/share/pi-resources/extensions/${name}.ts";
  bundledExtensionNames = [
    "better-openai"
    "clanker-working-messages"
    "context"
    "explore"
    "gpt-subagent"
    "herdr-terminal-images"
    "host-statusline"
    "librarian"
    "multi-edit"
    "split-fork"
    "todos"
    "tree-summary-model"
  ];
  bundledExtensionPaths = map bundledExtensionPath (
    lib.filter (
      name:
      builtins.elem name config.pi.bundledExtensions
      && (name != "librarian" || config.pi.librarian.mode == "tool")
    ) bundledExtensionNames
  );
  gondolinExtensionPath = bundledExtensionPath "gondolin";
  # Patching the splash rewrites Pi's own JavaScript, so it has to be done in the
  # package derivation rather than the wrapper output; see packages/pi/package.nix.
  # `null` leaves Pi's upstream splash alone and keeps the package identical to the
  # plain `.#pi` build.
  splashArgs =
    if config.pi.splash.enable then
      {
        logoText = builtins.toJSON config.pi.splash.logoText;
        versionText = builtins.toJSON config.pi.splash.versionText;
        compactHelpText = builtins.toJSON config.pi.splash.compactHelpText;
        helpText = builtins.toJSON config.pi.splash.helpText;
      }
    else
      null;
  mattPocockSkillsPackage = pkgs.runCommand "pi-package-mattpocock-skills" { } ''
    set -euo pipefail

    base="$out/share/pi-packages/mattpocock-skills"
    mkdir -p "$base"

    ${lib.concatMapStringsSep "\n" (skill: ''
      src_path="${config.pi.mattPocockSkills.source}/${skill}"
      dst_path="$base/${skill}"
      mkdir -p "$(dirname "$dst_path")"
      cp -R "$src_path" "$dst_path"
      chmod -R u+w "$dst_path"

      ${lib.optionalString (config.pi.mattPocockSkills.hiddenSkills != [ ]) ''
        case "${skill}" in
          ${lib.concatMapStringsSep "\n            " (skill: ''
            "${skill}")
              skill_md="$dst_path/SKILL.md"
              if ! grep -q '^disable-model-invocation:' "$skill_md"; then
                sed -i '/^description:/a disable-model-invocation: true' "$skill_md"
              fi
              ;;
          '') config.pi.mattPocockSkills.hiddenSkills}
        esac
      ''}
    '') config.pi.mattPocockSkills.skills}
  '';
  pstackSkillsPackage = pkgs.runCommand "pi-package-pstack-skills" { } ''
    set -euo pipefail

    base="$out/share/pi-packages/pstack-skills"
    mkdir -p "$base"

    ${lib.concatMapStringsSep "\n" (skill: ''
      src_path="${config.pi.pstackSkills.source}/pstack/skills/${skill}"
      dst_path="$base/${skill}"
      cp -R "$src_path" "$dst_path"
    '') config.pi.pstackSkills.skills}
  '';
  piResourcePackageType = lib.types.submodule {
    options = {
      package = lib.mkOption {
        type = lib.types.package;
        description = "Nix package providing Pi resources.";
      };

      extensions = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Extension paths exposed by this Pi resource package.";
      };

      skills = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Skill directories exposed by this Pi resource package.";
      };

      prompts = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Prompt directories exposed by this Pi resource package.";
      };

      themes = lib.mkOption {
        type = lib.types.listOf jsonFmtType;
        default = [ ];
        description = "Theme directories exposed by this Pi resource package.";
      };
    };
  };
  resourcePackageResources = name: lib.concatMap (pkg: pkg.${name}) config.pi.resourcePackages;
  defaultModelParts = lib.splitString "/" config.pi.defaultModel;
  generatedDefaultModel =
    if config.pi.defaultModel == null then
      { }
    else if builtins.length defaultModelParts > 1 then
      {
        defaultProvider = builtins.head defaultModelParts;
        defaultModel = lib.concatStringsSep "/" (builtins.tail defaultModelParts);
      }
    else
      {
        defaultModel = config.pi.defaultModel;
      };
  generatedExtensions =
    bundledExtensionPaths
    ++ lib.optionals config.pi.decompMatcher.enable [ (bundledExtensionPath "decomp-matcher") ]
    ++ lib.optionals config.pi.gondolin.enable [ gondolinExtensionPath ]
    ++ lib.optionals config.pi.camofoxBrowser.enable [
      "${piResources}/share/pi-resources/extensions/camofox-browser.ts"
    ]
    ++ lib.optionals config.pi.nixOptions.enable [
      "${piResources}/share/pi-resources/extensions/nix-options.ts"
    ]
    ++ resourcePackageResources "extensions"
    ++ lib.optionals config.pi.herdrIntegration.enable [
      herdrPiExtension
      (bundledExtensionPath "herdr-terminal-images")
    ];
  herdrPiExtension = "${config.pi.herdrIntegration.source}/src/integration/assets/pi/herdr-agent-state.ts";
  mattPocockResourcePackage = lib.optional config.pi.mattPocockSkills.enable {
    package = mattPocockSkillsPackage;
    skills = map (
      skill: "${mattPocockSkillsPackage}/share/pi-packages/mattpocock-skills/${skill}"
    ) config.pi.mattPocockSkills.skills;
  };
  pstackResourcePackage = lib.optional config.pi.pstackSkills.enable {
    package = pstackSkillsPackage;
    skills = map (
      skill: "${pstackSkillsPackage}/share/pi-packages/pstack-skills/${skill}"
    ) config.pi.pstackSkills.skills;
  };
in
{
  inherit
    agentTools
    bundledExtensionNames
    bundledExtensionPath
    chromeCdpPackage
    clarifyPackage
    codexConversionPackage
    codexGoalPackage
    dynamicWorkflowsPackage
    fffPackage
    generatedDefaultModel
    generatedExtensions
    jsonFmtType
    localSkillsDir
    mattPocockResourcePackage
    mattPocockSkillsPackage
    mcpAdapterPackage
    metaOAuthPackage
    piPackages
    piResourcePackageType
    piResources
    pstackResourcePackage
    pstackSkillsPackage
    resourceDirs
    resourcePackageResources
    reviewPackage
    splashArgs
    ;
}
