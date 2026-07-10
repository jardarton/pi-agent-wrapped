# Minimal coding profile: default appearance and core editing tools without
# subagent, workflow, goal, todo, or broad skill surfaces.
{
  pi = {
    profileName = "minimal";
    localSkills = [
      "commit"
      "github"
    ];
    bundledExtensions = [
      "clanker-working-messages"
      "context"
      "host-statusline"
      "librarian"
      "multi-edit"
      "split-fork"
      "tree-summary-model"
    ];
    fff.enable = true;
    dynamicWorkflows.enable = false;
    goal.enable = false;
    herdrSubagents.enable = false;
    mattPocockSkills.enable = false;
  };
}
