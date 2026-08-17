context:
{
  config,
  lib,
  ...
}:
let
  inherit (context)
    generatedDefaultModel
    generatedExtensions
    resourceDirs
    resourcePackageResources
    ;
in
{
  config = {
    constructFiles.generatedSettings = {
      relPath = "share/pi-wrapped/settings.json";
      content = builtins.toJSON (
        config.pi.settings
        // generatedDefaultModel
        // lib.optionalAttrs (config.pi.defaultThinkingLevel != null) {
          defaultThinkingLevel = config.pi.defaultThinkingLevel;
        }
        // lib.optionalAttrs (config.pi.theme != null) { theme = config.pi.theme; }
        // lib.optionalAttrs (config.pi.enabledModels != [ ]) {
          enabledModels = config.pi.enabledModels;
        }
        // {
          defaultProjectTrust = config.pi.projectTrust;
          enableInstallTelemetry = false;
          packages = config.pi.packages;
          skills = [ resourceDirs.skills ] ++ resourcePackageResources "skills";
          prompts = [ resourceDirs.prompts ] ++ resourcePackageResources "prompts";
          themes = [ resourceDirs.themes ] ++ resourcePackageResources "themes";
          extensions = generatedExtensions;
        }
      );
    };

    constructFiles.generatedKeybindings = {
      relPath = "share/pi-wrapped/keybindings.json";
      content = builtins.toJSON config.pi.keybindings;
    };

    constructFiles.generatedAgents = {
      relPath = "share/pi-wrapped/AGENTS.md";
      # Single-sourced with the repository's own AGENTS.md, which links to the same file.
      content = ''
        # Agent instructions

        ${builtins.readFile ../../../docs/pi-native-children.md}
      '';
    };

    constructFiles.generatedAppendSystemPrompt = {
      relPath = "share/pi-wrapped/APPEND_SYSTEM.md";
      content =
        if config.pi.overrideSystemPrompt != null then
          config.pi.overrideSystemPrompt
        else
          config.pi.appendSystemPrompt;
    };
  };
}
