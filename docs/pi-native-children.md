## Pi-native child processes

`PI_LAUNCHER_BIN` is the authoritative identity of the currently active Pi wrapper. Pi-native features that fork, resume, or create a child of the active Pi session must reuse this exact launcher. This includes split/fork, explore, and similar extension-managed child sessions.

Do not resolve a profile name from `PATH` or fall back to `process.execPath` for these Pi-native descendants. If `PI_LAUNCHER_BIN` is unavailable, fail instead of guessing.

This invariant does not apply to root launchers, generic orchestrators, configured commands, arbitrary shell commands, or explicit profile selection. Those may run any command selected by their user or configuration.

`run-current-pi` is an optional convenience for manually re-executing the active wrapper.

Examples:

```sh
run-current-pi
run-current-pi --session /path/to/session.jsonl
herdr pane run "$PANE" "run-current-pi --session '/path/to/session.jsonl'"
```
