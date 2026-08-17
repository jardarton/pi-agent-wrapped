{
  config,
  lib,
  pkgs,
  ...
}:
{
  config = {
    runShell = [
      # Gondolin image discovery can shell out to `nix build`, so it must only run
      # for profiles that actually enable Gondolin. Emitting it unconditionally made
      # every launch inside any flake directory pay for a Nix evaluation.
      (lib.optionalString config.pi.gondolin.enable ''
        configured_gondolin_image_path=${
          if config.pi.gondolin.imagePath == null then
            "''"
          else
            lib.escapeShellArg (toString config.pi.gondolin.imagePath)
        }

        resolve_gondolin_image_path() {
          if [ -f flake.nix ]; then
            if resolved_path="$(${pkgs.nix}/bin/nix --extra-experimental-features 'nix-command flakes' build .#gondolin-image --no-link --print-out-paths 2>/dev/null | tail -n 1)" && [ -n "$resolved_path" ]; then
              printf '%s\n' "$resolved_path"
              return 0
            fi
          fi

          if [ -n "''${GONDOLIN_IMAGE_PATH-}" ]; then
            printf '%s\n' "$GONDOLIN_IMAGE_PATH"
            return 0
          fi

          if [ -n "$configured_gondolin_image_path" ]; then
            printf '%s\n' "$configured_gondolin_image_path"
            return 0
          fi

          return 1
        }

        if resolved_gondolin_image_path="$(resolve_gondolin_image_path)"; then
          export GONDOLIN_IMAGE_PATH="$resolved_gondolin_image_path"
        fi
      '')
      ''
        profile_name=${lib.escapeShellArg config.pi.profileName}
        profile_dir="${config.pi.stateRoot}/$profile_name"
        mkdir -p "$profile_dir" "$profile_dir/sessions"
        copy_generated() {
          rm -f "$profile_dir/$2"
          cp "$1" "$profile_dir/$2"
          chmod 0644 "$profile_dir/$2"
        }
        copy_generated ${config.constructFiles.generatedSettings.path} settings.json
        copy_generated ${config.constructFiles.generatedKeybindings.path} keybindings.json
        copy_generated ${config.constructFiles.generatedAgents.path} AGENTS.md
        copy_generated ${config.constructFiles.generatedAppendSystemPrompt.path} APPEND_SYSTEM.md
        case "$0" in
          */*) launcher_candidate="$0" ;;
          *) launcher_candidate="$(command -v -- "$0" 2>/dev/null || true)" ;;
        esac
        if [ -z "$launcher_candidate" ]; then
          printf '%s\n' "pi wrapper: unable to resolve launcher path for $0" >&2
          exit 1
        fi
        if ! launcher_bin="$(${pkgs.coreutils}/bin/readlink -f -- "$launcher_candidate")"; then
          printf '%s\n' "pi wrapper: unable to canonicalize launcher path: $launcher_candidate" >&2
          exit 1
        fi
        if [ ! -f "$launcher_bin" ] || [ ! -x "$launcher_bin" ]; then
          printf '%s\n' "pi wrapper: canonical launcher is not an executable file: $launcher_bin" >&2
          exit 1
        fi
        export PI_LAUNCHER_BIN="$launcher_bin"
        export PI_CODING_AGENT_DIR="$profile_dir"
        export PI_PACKAGE_DIR="${config.package}/lib/node_modules/@earendil-works/pi-coding-agent"
        export PI_CODING_AGENT_SESSION_DIR="$profile_dir/sessions"
      ''
    ];
  };
}
