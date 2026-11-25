---
name: omt
description: Shared references for the omt skills. Not a workflow; do not load it. To pick a workflow, use omt-setup.
disable-model-invocation: true
user-invocable: false
metadata:
  internal: true
---

# oh-my-t3 shared references

This folder holds the files that the omt skills and the omt CLI share. It is not a workflow. The workflows are `omt-ulw`, `omt-plan`, `omt-design`, `omt-code-review`, and `omt-setup`; `omt-setup` says which one to use.

- [delegation.md](references/delegation.md): the T3 rules for every skill.
- [roles.md](references/roles.md) and [roles/](references/roles/_generic.md): the roles and their personas.
- [results.md](references/results.md) and [results/](references/results/work.md): the result blocks.
