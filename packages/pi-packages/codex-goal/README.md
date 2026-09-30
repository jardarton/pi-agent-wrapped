# Local continuation-cache patch

`continuation-cache.patch` is applied to the pinned `pi-codex-goal` source by
`../codex-goal.nix`. No upstream fork or additional runtime extension is needed.

Repeated active-goal continuations used to replace older reminders with
superseded bookkeeping text in provider context. That changed a previously sent
request prefix whenever another continuation was appended, defeating prefix-based
prompt caching. The patch leaves those active reminders and their usage snapshots
unchanged. Ordinary history pruning remains the host's compaction responsibility.

The scope is deliberately narrow: stale-goal rewriting and pending-work guards
are retained for paused, completed, cleared, and replaced goals. Such transitions
and host compaction can still change provider context; this is not a guarantee of
cache hits for every request. Keeping old active reminders also costs a little
more context until compaction.

The patch updates the existing rewrite assertions and adds regression tests for
serialized input prefixes, usage reads/accounting, and pause/resume. The package
build runs typecheck and the complete upstream suite, including existing stale-work
and compaction coverage.

Verify with:

```sh
nix build path:.#pi-codex-goal --no-link -L
git diff --check
```

When updating the upstream pin, review whether this fix is still needed, rebase
or remove the patch, and rerun the suite. Do not silently drop the stale-work
safeguards to preserve caching.
