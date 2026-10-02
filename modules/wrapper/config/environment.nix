{ config, lib, ... }:
{
  config = {
    envDefault = {
      PI_SKIP_VERSION_CHECK = "1";
      PI_TELEMETRY = "0";
      PI_TREE_SUMMARY_MODEL_ENABLED = if config.pi.cheapModels.treeSummary.enable then "1" else "0";
      PI_COMPACTION_MODEL_ENABLED = if config.pi.cheapModels.compaction.enable then "1" else "0";
    }
    // lib.optionalAttrs config.pi.gondolin.enable {
      PI_GONDOLIN_ENABLED = "1";
      PI_GONDOLIN_GUEST_MOUNT_PATH = config.pi.gondolin.guestMountPath;
    }
    // lib.optionalAttrs config.pi.betterOpenAI.imageTool.enable {
      PI_BETTER_OPENAI_IMAGE_TOOL = "1";
    }
    // lib.optionalAttrs config.pi.camofoxBrowser.enable (
      {
        CAMOFOX_URL = config.pi.camofoxBrowser.url;
      }
      // lib.optionalAttrs (config.pi.camofoxBrowser.apiKeyFile != null) {
        CAMOFOX_API_KEY_FILE = config.pi.camofoxBrowser.apiKeyFile;
      }
    )
    // lib.optionalAttrs (config.pi.cheapModels.primary != null) {
      PI_CHEAP_MODEL = config.pi.cheapModels.primary;
    }
    // lib.optionalAttrs (config.pi.cheapModels.fallbacks != [ ]) {
      PI_CHEAP_FALLBACK_MODELS = lib.concatStringsSep "," config.pi.cheapModels.fallbacks;
    };
  };
}
