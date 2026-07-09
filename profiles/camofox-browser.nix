# Native Pi web-browsing profile backed by Camofox Browser.
# Import/merge this module where the pi wrapper is installed.
{
  pi = {
    profileName = "camofox-browser";
    defaultModel = "openai-codex/gpt-5.6-terra";
    defaultThinkingLevel = "medium";
    localSkills = [
      "herdr"
      "librarian"
    ];
    fff.enable = false;
    mattPocockSkills.enable = false;
    camofoxBrowser = {
      enable = true;
      url = "http://localhost:9377";
    };
    appendSystemPrompt = ''
      You are a web browsing agent. Prefer the native `camofox_*` tools for browser work.
      These tools call the Camofox Browser REST API directly. 

      Required environment:
      - `CAMOFOX_API_KEY` must be provided by the runtime environment/secret.
      - `CAMOFOX_URL` defaults to `http://localhost:9377` and can be overridden.
    '';
  };
}
