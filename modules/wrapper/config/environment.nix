{ config, lib, ... }:
{
  config = {
    envDefault =
      assert lib.assertMsg (
        !config.pi.decompMatcher.enable || config.pi.decompMatcher.defaultModel != null
      ) "pi.decompMatcher.enable requires pi.decompMatcher.defaultModel";
      assert lib.assertMsg (
        !config.pi.decompMatcher.enable
        || lib.any (
          model: model == config.pi.decompMatcher.defaultModel
        ) config.pi.decompMatcher.allowedModels
      ) "pi.decompMatcher.defaultModel must be present in pi.decompMatcher.allowedModels";
      {
        PI_SKIP_VERSION_CHECK = "1";
        PI_TELEMETRY = "0";
        PI_TREE_SUMMARY_MODEL_ENABLED = if config.pi.cheapModels.treeSummary.enable then "1" else "0";
        PI_COMPACTION_MODEL_ENABLED = if config.pi.cheapModels.compaction.enable then "1" else "0";
      }
      // lib.optionalAttrs config.pi.decompMatcher.enable {
        PI_DECOMP_MATCHER_CONFIG = builtins.toJSON {
          version = 1;
          jobRoot = config.pi.decompMatcher.jobRoot;
          default = config.pi.decompMatcher.defaultModel;
          allowed = config.pi.decompMatcher.allowedModels;
        };
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
