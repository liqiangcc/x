---
name: execute-task-md
description: Execute a resumable Markdown task plan by task ID or subtask ID, updating task status and committing after every completed subtask. Use when the user provides a task number/ID from a task md, asks to continue/resume a task, or wants Codex to execute planned subtasks with git commits after each subtask.
---

# Execute Task MD

Execute tasks from a Markdown plan created by `plan-task-md`, using the task ID or subtask ID as the control point.

## Required Input

The user must provide at least one of:

- A root task ID, task ID, or subtask ID.
- A task Markdown file path.

If only an ID is provided, search `tasks/**/*.md` first, then the repository if needed.

## Workflow

1. Locate the task Markdown file and the requested ID.
2. Read the task, dependencies, target subtask list, expected files, and validation instructions.
3. Check `git status --short` before editing. Do not stage or commit unrelated existing changes.
4. Select the next executable `pending` subtask:
   - If the input is a subtask ID, execute only that subtask.
   - If the input is a task ID, execute the first pending subtask under that task whose dependencies are done.
   - If the input is a root ID, execute the first pending subtask in document order whose dependencies are done.
5. Mark the selected subtask `in_progress` in the Markdown before making code changes.
6. Implement the subtask.
7. Run the subtask validation command or document why validation could not be run.
8. Update the Markdown subtask entry:
   - Set status to `done` or `blocked`.
   - Fill in notes, validation result, changed files, and commit hash.
9. Stage only files related to that subtask, including the task Markdown file.
10. Commit immediately after each completed subtask.
11. Stop after one subtask unless the user explicitly asks to continue through multiple subtasks.

## Commit Rules

- Commit after every completed subtask.
- Use message format: `<subtask-id>: <short outcome>`.
- Include only files relevant to the completed subtask.
- If validation fails, do not commit a `done` subtask. Either fix it or mark the subtask `blocked` with the failure details.
- If the worktree has unrelated changes, leave them unstaged and mention them in the final response.

## Markdown Updates

When completing a subtask, update fields in place:

```markdown
- Status: `done`
- Validation: `npm test` -> passed
- Commit: `abc1234`
- Notes: <Brief implementation note>
```

If a task gains new required work during execution, add a new uniquely identified subtask after the current subtask. Do not renumber old IDs.

## Recovery Rules

- If a subtask is `in_progress` from a previous interrupted run, inspect the worktree and task notes before continuing.
- If the task file says `done` but no commit hash is present, verify git history before deciding whether it needs another commit.
- If the user asks to resume, prefer the first `in_progress` subtask, then the first `pending` subtask.

## Final Response

Report:

- The executed subtask ID and status.
- The commit hash if committed.
- Validation result.
- The next pending subtask ID, if any.
