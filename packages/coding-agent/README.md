# @praetor/coding-agent

Praetor's coding agent. A `NativePraetorEngine` preconfigured with a curated
tool subset and a system prompt focused on disciplined code changes.

## Tool surface

All tools are gated by the `coding` role and tagged `["coding", "free"]`
because none of them call a paid API.

| Tool             | What it does                                                              |
|------------------|---------------------------------------------------------------------------|
| `read_file`      | Read a UTF-8 file relative to `repoRoot`.                                 |
| `write_file`     | Create or overwrite a UTF-8 file. Creates parent dirs.                    |
| `edit_file`      | Replace every literal occurrence of `find` with `replace`.                |
| `list_files`     | List immediate children of a directory inside the repo.                  |
| `grep_codebase`  | Regex over all text files (skips `node_modules`, `.git`, `dist`).         |
| `git_status`     | Working-tree status (added/modified/deleted/staged).                      |
| `git_diff`       | Unstaged diff, optionally for a single path.                              |
| `git_commit`     | Stage and commit. Will not push or rebase.                                |
| `git_branch`     | List local branches and report the current one.                           |
| `git_log`        | Recent commits (default 20).                                              |
| `run_tests`      | Auto-detect (`npm test`, `pytest`, `cargo test`, `go test`) and run.      |
| `run_command`    | Spawn an arbitrary command; cwd pinned to `repoRoot`, 30s timeout.        |

## Path safety

Every file path supplied to a file tool is resolved against the configured
`repoRoot` and rejected if it escapes the root (the same containment
pattern as the world-gen scene server in the API).

## Free vs. paid model routing

The agent constructs its inner `NativePraetorEngine` with
`{ quality: "balanced", preferTags: ["coding"] }`. With the default
catalogue this lands on Claude Sonnet (paid) or Xiaomi MiMo-V2.5 (open
weight, sovereign-mode eligible) — pass an explicit `route` requirement
to force one or the other:

```ts
new CodingAgent({
  ...,
  route: { quality: "balanced", sovereign: true }, // open-weight only
});
```

## Usage

```ts
import { CodingAgent } from "@praetor/coding-agent";
import { LlmRouter } from "@praetor/router";
import { ToolRegistry } from "@praetor/tools";

const router = new LlmRouter();
const tools = new ToolRegistry();
const agent = new CodingAgent({
  repoRoot: "/abs/path/to/repo",
  router,
  tools,
  toolContext: {},
});

const result = await agent.run({
  goal: "Add a /healthz route to the API and a test that asserts 200",
  outputs: [],
  budgetUsd: 1,
});
```
