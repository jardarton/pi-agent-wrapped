{
  lib,
  wrapper,
}:
{
  pkgs,
  profileName,
  binName ? "p-${profileName}",
  aliases ? [ ],
  modules ? [ ],
}:
let
  launcherNamePattern = "[A-Za-z0-9][A-Za-z0-9._+-]*";
  launcherNames = [ binName ] ++ aliases;
  evaluated = wrapper.extendModules {
    modules = modules ++ [
      {
        binName = lib.mkForce binName;
        pi.profileName = lib.mkForce profileName;
      }
    ];
  };
  wrapped = evaluated.config.wrap { inherit pkgs; };
in
assert lib.assertMsg (
  builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" profileName != null
) "mkProfile: profileName must be a safe Pi profile name";
assert lib.assertMsg (builtins.all (
  name: builtins.match launcherNamePattern name != null
) launcherNames) "mkProfile: binName and aliases must be safe executable names";
assert lib.assertMsg (
  builtins.length launcherNames == builtins.length (lib.unique launcherNames)
) "mkProfile: binName and aliases must be unique";
pkgs.runCommand "pi-profile-${profileName}-launchers"
  {
    passthru = {
      fullPackage = wrapped;
      inherit profileName binName aliases;
    };
    meta = (wrapped.meta or { }) // {
      description = "Pi wrapper launchers for the ${profileName} profile";
      mainProgram = binName;
    };
  }
  ''
    mkdir -p "$out/bin"
    ${lib.concatMapStringsSep "\n" (name: ''
      ln -s ${lib.escapeShellArg "${wrapped}/bin/${binName}"} "$out/bin"/${lib.escapeShellArg name}
    '') launcherNames}
  ''
