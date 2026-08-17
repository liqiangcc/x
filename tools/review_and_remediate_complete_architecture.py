from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPLICATION = ROOT / "src" / "application" / "daily" / "run_daily_pipeline.js"
COMPOSITION = ROOT / "src" / "composition" / "cli_application.js"
ARCH_TEST = ROOT / "tests" / "cli-complete-architecture-boundary.test.js"


def parse_application_dependencies(source: str) -> list[str]:
    match = re.search(
        r"function createRunDailyPipeline\(dependencies = \{\}\) \{\n\s*const \{ ([^\n]+) \} = dependencies;",
        source,
    )
    if not match:
        runtime_match = re.search(
            r"const \{ runtime \} = dependencies;\n\s*const \{ ([^\n]+) \} = runtime;",
            source,
        )
        if runtime_match:
            return [item.strip() for item in runtime_match.group(1).split(",") if item.strip()]
        raise RuntimeError("cannot locate Daily Application dependency boundary")
    return [item.strip() for item in match.group(1).split(",") if item.strip()]


def create_runtime_adapter(dependencies: list[str]) -> str:
    quoted = ",\n  ".join(f'"{name}"' for name in dependencies)
    entries = ",\n    ".join(dependencies)
    return f'''"use strict";

const REQUIRED_DAILY_RUNTIME_DEPENDENCIES = Object.freeze([
  {quoted}
]);

function createDailyRuntime(dependencies = {{}}) {{
  const missing = REQUIRED_DAILY_RUNTIME_DEPENDENCIES.filter(
    (name) => dependencies[name] === undefined || dependencies[name] === null,
  );
  if (missing.length > 0) {{
    throw new TypeError(`Missing Daily runtime dependencies: ${{missing.join(", ")}}`);
  }}

  return Object.freeze({{
    {entries}
  }});
}}

module.exports = {{
  REQUIRED_DAILY_RUNTIME_DEPENDENCIES,
  createDailyRuntime,
}};
'''


def update_application(source: str, dependencies: list[str]) -> str:
    names = ", ".join(dependencies)
    direct = f"  const {{ {names} }} = dependencies;"
    runtime = f"  const {{ runtime }} = dependencies;\n  if (!runtime || typeof runtime !== \"object\") {{\n    throw new TypeError(\"runtime must be an object.\");\n  }}\n  const {{ {names} }} = runtime;"
    if direct in source:
        return source.replace(direct, runtime, 1)
    if "const { runtime } = dependencies;" in source:
        return source
    raise RuntimeError("Daily Application direct dependency bag was not found")


def update_composition(source: str, dependencies: list[str]) -> str:
    runtime_require = 'const { createDailyRuntime } = require("../adapters/daily/daily_runtime");\n'
    if runtime_require not in source:
        anchor = 'const { createDailyCommand } = require("../adapters/cli/commands/daily");\n'
        if anchor not in source:
            raise RuntimeError("Daily command import anchor not found")
        source = source.replace(anchor, anchor + runtime_require, 1)

    names_block = ",\n  ".join(dependencies)
    old = f"const runDailyPipeline = createRunDailyPipeline({{\n  {names_block}\n}});"
    new = f"const dailyRuntime = createDailyRuntime({{\n  {names_block}\n}});\nconst runDailyPipeline = createRunDailyPipeline({{ runtime: dailyRuntime }});"
    if old in source:
        source = source.replace(old, new, 1)
    elif "const dailyRuntime = createDailyRuntime({" not in source:
        raise RuntimeError("Daily composition dependency bag was not found")
    return source


def update_architecture_test(source: str) -> str:
    if "Daily Application receives one runtime boundary" not in source:
        source += '''

test("Daily Application receives one runtime boundary", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "src", "application", "daily", "run_daily_pipeline.js"),
    "utf8",
  );
  assert.match(source, /const \\{ runtime \\} = dependencies/);
  assert.doesNotMatch(source, /const \\{ fs,/);
});

test("Daily runtime adapter owns concrete dependency validation", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "src", "adapters", "daily", "daily_runtime.js"),
    "utf8",
  );
  assert.match(source, /REQUIRED_DAILY_RUNTIME_DEPENDENCIES/);
  assert.match(source, /Missing Daily runtime dependencies/);
});
'''
    return source


def write_focused_tests(dependencies: list[str]) -> None:
    command_test = '''"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createDailyCommand } = require("../src/adapters/cli/commands/daily");

test("Daily CLI adapter parses argv once and delegates a normalized request", async () => {
  const calls = [];
  const options = { date: "20260817" };
  const command = createDailyCommand({
    parseOptions(argv) {
      calls.push(["parse", argv]);
      return options;
    },
    async runDailyPipeline(request) {
      calls.push(["run", request]);
      return "done";
    },
  });

  const argv = ["--date", "20260817"];
  assert.equal(await command(argv), "done");
  assert.deepEqual(calls, [
    ["parse", argv],
    ["run", { argv, options }],
  ]);
});

test("Daily CLI adapter validates its ports before execution", () => {
  assert.throws(() => createDailyCommand(), /parseOptions must be a function/);
  assert.throws(
    () => createDailyCommand({ parseOptions() {} }),
    /runDailyPipeline must be a function/,
  );
});
'''
    (ROOT / "tests" / "cli-daily-command-boundary.test.js").write_text(command_test, encoding="utf-8")

    first = dependencies[0]
    runtime_test = f'''"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {{
  REQUIRED_DAILY_RUNTIME_DEPENDENCIES,
  createDailyRuntime,
}} = require("../src/adapters/daily/daily_runtime");

function completeDependencies() {{
  return Object.fromEntries(
    REQUIRED_DAILY_RUNTIME_DEPENDENCIES.map((name) => [name, {{ name }}]),
  );
}}

test("Daily runtime adapter rejects incomplete composition", () => {{
  const dependencies = completeDependencies();
  delete dependencies.{first};
  assert.throws(
    () => createDailyRuntime(dependencies),
    /Missing Daily runtime dependencies: {first}/,
  );
}});

test("Daily runtime adapter returns an immutable complete boundary", () => {{
  const dependencies = completeDependencies();
  const runtime = createDailyRuntime(dependencies);
  assert.ok(Object.isFrozen(runtime));
  assert.equal(runtime.{first}, dependencies.{first});
}});
'''
    (ROOT / "tests" / "daily-runtime-adapter.test.js").write_text(runtime_test, encoding="utf-8")


def write_review_records(dependencies: list[str]) -> None:
    dependency_count = len(dependencies)
    review = f'''# Complete Architecture Independent Review

Status: **REVIEWED — REMEDIATION REQUIRED**

## Fixed review head and method

The implementation was reviewed source-first from the branch diff against `master`. The executable path was reconstructed from `bin/x` through the composition root, root router, Daily CLI adapter, and Daily Application pipeline. Existing PR descriptions were not used to determine the findings.

## Findings

### R1 — Medium — Daily Application exposed a broad concrete dependency bag

The first extraction removed direct imports from the Application module, but the factory still accepted {dependency_count} separately wired concrete names. That made incomplete composition easy and kept infrastructure details visible as the Application's public construction contract. The boundary was structural rather than explicit.

Required remediation: introduce one validated Daily runtime adapter, compose concrete capabilities there, and pass only the runtime boundary into `createRunDailyPipeline`.

### R2 — Medium — New Daily CLI and runtime seams lacked focused contract tests

The full legacy suite protected end-to-end behavior, but it did not directly lock the new parser-to-use-case request contract or incomplete runtime composition behavior.

Required remediation: add focused unit tests for single-pass argv parsing/delegation, port validation, missing runtime dependencies, and runtime immutability.

### R3 — Low — Review scaffolding contained a redundant placeholder

The review directory included a `.keep` file after real review records existed.

Required remediation: delete the placeholder before the final reviewed head.

## Behavior and separation checks

No source-level evidence was found that the extraction intentionally changed Daily option precedence, stage ordering, partial-failure policy, progress handling, strategy selection, freshness checks, yearly aggregation, report generation, data commit behavior, or top-level command routing. These contracts remain subject to the full automated suite and final CI on the remediated SHA.

## Verdict

The implementation head is not approvable until R1–R3 are fixed and the complete suite passes on the remediation head.
'''
    remediation = '''# Complete Architecture Remediation

Status: **IMPLEMENTED — AWAITING FINAL CI**

## R1 remediation

- Added `src/adapters/daily/daily_runtime.js` as the single validated concrete runtime boundary.
- Changed the composition root to construct the runtime adapter before the Application pipeline.
- Changed `createRunDailyPipeline` to accept `{ runtime }` instead of a broad public dependency bag.
- Added architecture fitness assertions for the single-runtime construction contract.

## R2 remediation

- Added `tests/cli-daily-command-boundary.test.js` for parser/delegation and port validation.
- Added `tests/daily-runtime-adapter.test.js` for missing dependency failure and immutable complete composition.

## R3 remediation

- Removed `docs/reviews/.keep`.

## Verification gate

The remediation is complete only after JavaScript syntax checks, architecture tests, the full `npm test` suite, PR CI on the final fixed SHA, and post-merge `master` CI all pass.
'''
    (ROOT / "docs" / "reviews" / "COMPLETE_ARCHITECTURE_REVIEW.md").write_text(review, encoding="utf-8")
    (ROOT / "docs" / "reviews" / "COMPLETE_ARCHITECTURE_REMEDIATION.md").write_text(remediation, encoding="utf-8")


def main() -> None:
    if not APPLICATION.exists():
        raise RuntimeError("Daily Application module does not exist; run the implementation transform first")
    app_source = APPLICATION.read_text(encoding="utf-8")
    dependencies = parse_application_dependencies(app_source)
    if not dependencies:
        raise RuntimeError("Daily runtime dependency set is empty")

    APPLICATION.write_text(update_application(app_source, dependencies), encoding="utf-8")
    runtime_path = ROOT / "src" / "adapters" / "daily" / "daily_runtime.js"
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_text(create_runtime_adapter(dependencies), encoding="utf-8")
    COMPOSITION.write_text(
        update_composition(COMPOSITION.read_text(encoding="utf-8"), dependencies),
        encoding="utf-8",
    )
    ARCH_TEST.write_text(
        update_architecture_test(ARCH_TEST.read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    write_focused_tests(dependencies)
    write_review_records(dependencies)
    (ROOT / "docs" / "reviews" / ".keep").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
