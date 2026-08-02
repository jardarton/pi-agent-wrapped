---
name: gpt-subagent
description: "Run a task in a GPT subagent: a second Pi session in its own Herdr pane. Use when the user asks for a subagent or for a second opinion from GPT. Requires HERDR_ENV=1."
---

# GPT subagent

Herdr gives the pane. Pi gives the agent. `--model` gives GPT.

The `herdr` skill is the CLI reference. The agent kind is `pi`. Pi's arguments come after `--`:

```bash
herdr agent start <name> --kind pi --pane <id> -- --model "${PI_PROVIDER}/gpt-5.6-terra"
```

`PI_PROVIDER` contains the current provider and can be used for model selection.

The provider prefix is necessary. A bare model name can match a provider that has no key.

- `gpt-5.6-luna`
- `gpt-5.6-terra`
- `gpt-5.6-sol`

The subagent does not see this conversation. Its prompt contains everything.
