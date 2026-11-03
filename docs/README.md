# oh-my-t3 docs

Start with the page that fits your task. The [project README](../README.md) has the pitch, and its [Install](../README.md#install) section installs omt.

| Page | Read it when |
| --- | --- |
| [install.md](install.md) | You install omt for one project or for your user, or you want to know which files the install writes. |
| [releasing.md](releasing.md) | You are the owner, and you publish a new version to npm and GitHub. |
| [agents/quickstart.md](agents/quickstart.md) | You are a coding agent, and your user asked you to evaluate, install, or use omt. |
| [configuration.md](configuration.md) | You change the models of a role, add a custom role or profile, or set fast mode. |
| [workflows.md](workflows.md) | You want to know how a build, a plan, a parallel swarm, or a pull request review runs, how omt adds tests, or how parallel workers share builds. |
| [commands.md](commands.md) | You look up an `omt` command. |
| [walkthrough.md](walkthrough.md) | You want to see two real runs from before the workflow fold: the plan, the tasks by role, the reviews, and the result. |
| [spec.md](spec.md) | You change the code, the skills, or the tests. The spec is the contract for all three. |
| [design.md](design.md) | You want to know why each part of omt exists, and what is out of scope. |
| [design/](design/) | You want the design of one change, such as the [workflow fold](design/workflow-fold.md) that moved the build into the main thread. |
| [architecture.html](architecture.html) | You want the architecture with diagrams. Open the file in a browser. It is one self-contained page. |
| [research/](research/) | You want background. See the next section. |

## Research notes

The notes in `research/` are background notes on other projects and on T3 Code. Most notes read one project at one commit. Two notes survey papers and articles. Each note says which ideas could fit omt. They are not a roadmap or a feature list. An idea in a note is not a promise that omt has it or will get it. The [spec](spec.md) says what omt does.

| Note | Subject |
| --- | --- |
| [t3-orchestrator-v2.md](research/t3-orchestrator-v2.md) | What an agent inside a T3 thread can do with the orchestrator v2 tools. The note reads a T3 source snapshot from before v0.1.0. Its first paragraph lists what changed. |
| [t3-extension-points.md](research/t3-extension-points.md) | How T3 Code loads provider settings, skills, and hooks. The note reads a T3 source snapshot from before v0.1.0. Its first paragraph lists what changed. |
| [oh-my-openagent.md](research/oh-my-openagent.md) | The orchestration design of oh-my-openagent (OmO). |
| [oh-my-pi.md](research/oh-my-pi.md) | The roles, agents, and review recipe of oh-my-pi (omp). |
| [prime-agent.md](research/prime-agent.md) | prime-agent: a REPL-based agent with a self-improvement loop, a daemon for long tasks, and subagents. |
| [deepseek-harness.md](research/deepseek-harness.md) | deepseek-harness: an agent built from plugins, with goals, the Ralph loop, and subagent backends. |
| [self-improvement.md](research/self-improvement.md) | Self-improvement in prime-agent and deepseek-harness, and a design sketch for omt. |
| [swarm.md](research/swarm.md) | The article "On the Nature of the Swarm" and related work. |
| [ouro-bibliography.md](research/ouro-bibliography.md) | A survey of the 76 entries in the ouro bibliography. |
