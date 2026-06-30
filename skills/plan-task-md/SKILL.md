---
name: plan-task-md
description: Create a resumable Markdown task plan from a user's question, request, or implementation goal. Use when the user asks to turn an objective into tasks, create a task md, plan work for later execution, split a goal into uniquely identified tasks/subtasks, or prepare work that can be resumed by task ID.
---

# Plan Task MD

Create a task Markdown file that another Codex session can execute later with only a task ID or subtask ID.

## Workflow

1. Clarify only if the goal is too ambiguous to create actionable tasks.
2. Inspect the repository enough to avoid generic planning when the goal references existing code.
3. Choose a stable output path. Prefer `tasks/<task-id>.md`; create `tasks/` if needed.
4. Generate one root task ID and unique IDs for every task and subtask.
5. Break the work into executable subtasks with clear files, validation, and commit expectations.
6. Leave all statuses as `pending` unless the user explicitly asks to mark something started or done.

## ID Rules

- Root task ID format: `TASK-YYYYMMDD-HHMM-<slug>`.
- Task ID format: `<root-id>-TNN`, for example `TASK-20260522-1410-kline-cache-T01`.
- Subtask ID format: `<task-id>-SNN`, for example `TASK-20260522-1410-kline-cache-T01-S02`.
- IDs must be unique inside the Markdown file and stable after creation.
- Do not renumber existing IDs during later edits. Add new IDs at the end of the relevant section.

## Markdown Format

Use this structure exactly unless the user asks for a different format:

```markdown
# <Short Goal>

- Root ID: `TASK-YYYYMMDD-HHMM-<slug>`
- Status: `pending`
- Created: `YYYY-MM-DD HH:MM <timezone>`
- Source request: <verbatim or concise user request>
- Task file: `<relative/path/to/this-file.md>`

## Objective

<One paragraph describing the intended outcome.>

## Context

- <Relevant repo paths, commands, constraints, or assumptions.>

## Execution Rules

- Execute subtasks in listed order unless dependencies say otherwise.
- Update this file after each subtask with status, notes, validation, changed files, and commit hash.
- Commit only files related to the completed subtask.
- Do not mark a subtask `done` without validation or a documented reason validation was skipped.

## Tasks

### `TASK-YYYYMMDD-HHMM-<slug>-T01` <Task Title>

- Status: `pending`
- Depends on: `none`
- Goal: <Specific result>
- Files likely touched: `<path>`, `<path>`
- Validation: `<command>` or `<manual check>`

#### Subtasks

##### `TASK-YYYYMMDD-HHMM-<slug>-T01-S01` <Subtask Title>

- Status: `pending`
- Goal: <Small executable result>
- Steps:
  - <Step>
  - <Step>
- Expected files: `<path>`, `<path>`
- Validation: `<command>` or `<manual check>`
- Commit: `pending`
- Notes:
```

## Subtask Quality Bar

Each subtask must be small enough to complete and commit independently. A good subtask has:

- One observable outcome.
- A bounded file scope.
- A validation command or explicit manual check.
- No hidden dependency on future subtasks.
- Enough context that another session can execute it without rereading the original conversation.

## Output Guidance

After creating the file, report:

- The task file path.
- The root task ID.
- The first recommended subtask ID to execute.
- Any assumptions that materially affect execution.
