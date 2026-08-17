from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "bin" / "x"


@dataclass
class FunctionBlock:
    name: str
    start: int
    end: int
    source: str


def find_matching_brace(text: str, open_pos: int) -> int:
    depth = 0
    i = open_pos
    state = "code"
    quote = ""
    regex_allowed = True
    template_depths: list[int] = []
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "line_comment":
            if ch == "\n":
                state = "code"
                regex_allowed = True
            i += 1
            continue
        if state == "block_comment":
            if ch == "*" and nxt == "/":
                state = "code"
                i += 2
                continue
            i += 1
            continue
        if state == "string":
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                state = "code"
            i += 1
            continue
        if state == "template":
            if ch == "\\":
                i += 2
                continue
            if ch == "`" and not template_depths:
                state = "code"
                i += 1
                continue
            if ch == "$" and nxt == "{":
                template_depths.append(1)
                i += 2
                continue
            if template_depths:
                if ch == "{":
                    template_depths[-1] += 1
                elif ch == "}":
                    template_depths[-1] -= 1
                    if template_depths[-1] == 0:
                        template_depths.pop()
            i += 1
            continue
        if state == "regex":
            if ch == "\\":
                i += 2
                continue
            if ch == "[":
                state = "regex_class"
                i += 1
                continue
            if ch == "/":
                state = "code"
                i += 1
                while i < len(text) and text[i].isalpha():
                    i += 1
                regex_allowed = False
                continue
            i += 1
            continue
        if state == "regex_class":
            if ch == "\\":
                i += 2
                continue
            if ch == "]":
                state = "regex"
            i += 1
            continue

        if ch == "/" and nxt == "/":
            state = "line_comment"
            i += 2
            continue
        if ch == "/" and nxt == "*":
            state = "block_comment"
            i += 2
            continue
        if ch in ("'", '"'):
            state = "string"
            quote = ch
            i += 1
            continue
        if ch == "`":
            state = "template"
            template_depths = []
            i += 1
            continue
        if ch == "/" and regex_allowed:
            state = "regex"
            i += 1
            continue
        if ch == "{":
            depth += 1
            regex_allowed = True
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
            regex_allowed = False
        elif ch in "([,:;=!?&|+-*%^~<>":
            regex_allowed = True
        elif not ch.isspace():
            regex_allowed = False
        i += 1
    raise RuntimeError(f"unmatched brace at {open_pos}")


def top_level_functions(text: str) -> dict[str, FunctionBlock]:
    blocks: dict[str, FunctionBlock] = {}
    pattern = re.compile(r"(?m)^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
    for match in pattern.finditer(text):
        open_pos = text.find("{", match.end())
        if open_pos < 0:
            continue
        end = find_matching_brace(text, open_pos) + 1
        if end < len(text) and text[end] == "\r":
            end += 1
        if end < len(text) and text[end] == "\n":
            end += 1
        name = match.group(1)
        blocks[name] = FunctionBlock(name, match.start(), end, text[match.start():end])
    return blocks


def called_functions(source: str, names: set[str]) -> set[str]:
    return {
        name
        for name in names
        if re.search(rf"\b{re.escape(name)}\s*\(", source)
    }


def remove_blocks(text: str, blocks: list[FunctionBlock]) -> str:
    for block in sorted(blocks, key=lambda item: item.start, reverse=True):
        text = text[:block.start] + text[block.end:]
    return text


def collect_declared_names(text: str, functions: dict[str, FunctionBlock]) -> set[str]:
    names = set(functions)
    for match in re.finditer(r"(?m)^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", text):
        names.add(match.group(1))
    for match in re.finditer(r"(?ms)^(?:const|let|var)\s*\{([^}]+)\}\s*=", text):
        for piece in match.group(1).split(","):
            token = piece.strip().split(":")[-1].split("=")[0].strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", token):
                names.add(token)
    return names


def referenced(source: str, candidates: set[str], excluded: set[str]) -> list[str]:
    return sorted(
        name
        for name in candidates
        if name not in excluded and re.search(rf"\b{re.escape(name)}\b", source)
    )


def indent(text: str, spaces: int = 2) -> str:
    prefix = " " * spaces
    return "".join(prefix + line if line.strip() else line for line in text.splitlines(keepends=True))


def point_static_source_reads_to_composition(source: str) -> str:
    replacements = {
        'readFileSync(path.join(ROOT, "bin", "x"), "utf8")': 'readFileSync(path.join(ROOT, "src", "composition", "cli_application.js"), "utf8")',
        "readFileSync(path.join(ROOT, 'bin', 'x'), 'utf8')": "readFileSync(path.join(ROOT, 'src', 'composition', 'cli_application.js'), 'utf8')",
        'readFile(path.join(ROOT, "bin", "x"), "utf8")': 'readFile(path.join(ROOT, "src", "composition", "cli_application.js"), "utf8")',
        "readFile(path.join(ROOT, 'bin', 'x'), 'utf8')": "readFile(path.join(ROOT, 'src', 'composition', 'cli_application.js'), 'utf8')",
        'fs.readFileSync(path.resolve(__dirname, "../bin/x"), "utf8")': 'fs.readFileSync(path.resolve(__dirname, "../src/composition/cli_application.js"), "utf8")',
        "fs.readFileSync(path.resolve(__dirname, '../bin/x'), 'utf8')": "fs.readFileSync(path.resolve(__dirname, '../src/composition/cli_application.js'), 'utf8')",
    }
    for old, new in replacements.items():
        source = source.replace(old, new)
    return source


def main() -> None:
    original = ENTRY.read_text(encoding="utf-8")
    if "src/composition/cli_application" in original:
        raise RuntimeError("complete architecture refactor was already applied")
    shebang = "#!/usr/bin/env node\n"
    source = original[len(shebang):] if original.startswith(shebang) else original
    functions = top_level_functions(source)
    required = {"commandDaily", "main", "printUsage"}
    missing = required - functions.keys()
    if missing:
        raise RuntimeError(f"missing required functions: {sorted(missing)}")

    names = set(functions)
    reachable = {"commandDaily"}
    pending = ["commandDaily"]
    while pending:
        current = pending.pop()
        for called in called_functions(functions[current].source, names):
            if called not in reachable and called not in {"main", "printUsage"}:
                reachable.add(called)
                pending.append(called)

    outside = [
        block.source
        for name, block in functions.items()
        if name not in reachable
    ]
    outside.append(remove_blocks(source, list(functions.values())))
    outside_source = "\n".join(outside)
    shared = {
        name
        for name in reachable - {"commandDaily"}
        if re.search(rf"\b{re.escape(name)}\b", outside_source)
    }
    moved_names = reachable - shared
    moved_blocks = sorted((functions[name] for name in moved_names), key=lambda item: item.start)

    daily_sources: list[str] = []
    for block in moved_blocks:
        block_source = block.source
        if block.name == "commandDaily":
            block_source = re.sub(
                r"^(async\s+)?function\s+commandDaily\s*\([^)]*\)",
                lambda match: f"{match.group(1) or ''}function runDailyPipeline(input = {{}})",
                block_source,
                count=1,
            )
            parsed = False
            for variable in ("opts", "options"):
                pattern = rf"(?m)^\s*const\s+{variable}\s*=\s*parseOptions\(args\);\s*\n"
                if re.search(pattern, block_source):
                    block_source = re.sub(
                        pattern,
                        f"  const {variable} = input.options;\n  const args = input.argv || [];\n",
                        block_source,
                        count=1,
                    )
                    parsed = True
                    break
            if not parsed:
                raise RuntimeError("commandDaily parser boundary was not found")
        daily_sources.append(block_source)
    daily_body = "\n".join(daily_sources)
    if re.search(r"\bparseOptions\s*\(", daily_body):
        raise RuntimeError("Daily Application code still parses CLI options")

    candidates = collect_declared_names(source, functions) | {"process", "console"}
    daily_dependencies = referenced(daily_body, candidates, moved_names | {"runDailyPipeline"})

    daily_module = (
        '"use strict";\n\n'
        "/** Application boundary for the complete Daily pipeline. */\n"
        "function createRunDailyPipeline(dependencies = {}) {\n"
        f"  const {{ {', '.join(daily_dependencies)} }} = dependencies;\n\n"
        f"{indent(daily_body.rstrip() + chr(10))}\n"
        "  return runDailyPipeline;\n"
        "}\n\n"
        "module.exports = { createRunDailyPipeline };\n"
    )

    daily_adapter = '''"use strict";

function createDailyCommand({ parseOptions, runDailyPipeline } = {}) {
  if (typeof parseOptions !== "function") {
    throw new TypeError("parseOptions must be a function.");
  }
  if (typeof runDailyPipeline !== "function") {
    throw new TypeError("runDailyPipeline must be a function.");
  }

  return async function commandDaily(args) {
    const argv = Array.isArray(args) ? args : [];
    return runDailyPipeline({ argv, options: parseOptions(argv) });
  };
}

module.exports = { createDailyCommand };
'''

    main_source = functions["main"].source
    router_dependencies = referenced(
        main_source,
        candidates | {"commandDaily", "printUsage"},
        {"main"},
    )
    root_router = (
        '"use strict";\n\n'
        "/** Top-level CLI routing adapter. */\n"
        "function createRootRouter(dependencies = {}) {\n"
        f"  const {{ {', '.join(router_dependencies)} }} = dependencies;\n\n"
        f"{indent(main_source.rstrip() + chr(10))}\n"
        "  return main;\n"
        "}\n\n"
        "module.exports = { createRootRouter };\n"
    )

    usage_source = functions["printUsage"].source
    usage_module = (
        '"use strict";\n\n'
        "function createPrintUsage({ console } = {}) {\n"
        "  if (!console || typeof console.log !== \"function\") {\n"
        "    throw new TypeError(\"console.log must be available.\");\n"
        "  }\n\n"
        f"{indent(usage_source.rstrip() + chr(10))}\n"
        "  return printUsage;\n"
        "}\n\n"
        "module.exports = { createPrintUsage };\n"
    )

    removed = moved_names | {"main", "printUsage"}
    remaining = remove_blocks(source, [functions[name] for name in removed])
    invocation = re.search(r"(?ms)^main\(\)\.catch\(.*?\);\s*$", remaining)
    if invocation:
        remaining = remaining[:invocation.start()]
    else:
        index = remaining.rfind("\nmain().catch")
        if index < 0:
            raise RuntimeError("cannot find old CLI invocation boundary")
        remaining = remaining[:index]

    remaining = remaining.replace('require("../src/', 'require("../')
    remaining = remaining.replace("require('../src/", "require('../")
    remaining = remaining.replace('require("../fetch/', 'require("../../fetch/')
    remaining = remaining.replace("require('../fetch/", "require('../../fetch/")
    remaining = remaining.replace('path.resolve(__dirname, "..")', 'path.resolve(__dirname, "../..")')
    remaining = remaining.replace("path.resolve(__dirname, '..')", "path.resolve(__dirname, '../..')")

    injected = '''const { createDailyCommand } = require("../adapters/cli/commands/daily");
const { createRootRouter } = require("../adapters/cli/root_router");
const { createPrintUsage } = require("../adapters/cli/usage");
const { createRunDailyPipeline } = require("../application/daily/run_daily_pipeline");
'''
    insert_at = remaining.find("const { createDoctorCommand }")
    if insert_at < 0:
        raise RuntimeError("cannot locate composition import insertion point")
    remaining = remaining[:insert_at] + injected + remaining[insert_at:]

    daily_dep_lines = ",\n  ".join(daily_dependencies)
    router_dep_lines = ",\n  ".join(router_dependencies)
    tail = f'''
const runDailyPipeline = createRunDailyPipeline({{
  {daily_dep_lines}
}});
const commandDaily = createDailyCommand({{ parseOptions, runDailyPipeline }});
const printUsage = createPrintUsage({{ console }});
const rootRouter = createRootRouter({{
  {router_dep_lines}
}});

function createCliApplication() {{
  return Object.freeze({{
    run: rootRouter,
    commands: Object.freeze({{ daily: commandDaily }}),
  }});
}}

async function runCli() {{
  return rootRouter();
}}

module.exports = {{ createCliApplication, runCli }};
'''
    composition = '"use strict";\n\n' + remaining.strip() + "\n" + tail
    entry = '''#!/usr/bin/env node

const { runCli } = require("../src/composition/cli_application");

runCli().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
'''

    outputs = {
        ROOT / "src" / "application" / "daily" / "run_daily_pipeline.js": daily_module,
        ROOT / "src" / "adapters" / "cli" / "commands" / "daily.js": daily_adapter,
        ROOT / "src" / "adapters" / "cli" / "root_router.js": root_router,
        ROOT / "src" / "adapters" / "cli" / "usage.js": usage_module,
        ROOT / "src" / "composition" / "cli_application.js": composition,
        ENTRY: entry,
    }
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    for test_path in (ROOT / "tests").rglob("*.test.js"):
        old = test_path.read_text(encoding="utf-8")
        new = point_static_source_reads_to_composition(old)
        if new != old:
            test_path.write_text(new, encoding="utf-8")

    architecture_test = '''"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("bin/x remains a thin executable entry", () => {
  const source = fs.readFileSync(path.join(ROOT, "bin", "x"), "utf8");
  const lines = source.trimEnd().split(/\\r?\\n/);
  assert.ok(lines.length <= 12, `bin/x grew to ${lines.length} lines`);
  assert.match(source, /require\\("\\.\\.\\/src\\/composition\\/cli_application"\\)/);
  assert.doesNotMatch(source, /node:(?:fs|path|os|child_process)/);
  assert.doesNotMatch(source, /function\\s+commandDaily/);
});

test("Daily Application boundary has no direct CLI or Node imports", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "src", "application", "daily", "run_daily_pipeline.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /require\\(["']node:/);
  assert.doesNotMatch(source, /adapters\\/cli/);
  assert.doesNotMatch(source, /parseOptions\\s*\\(/);
  assert.match(source, /function createRunDailyPipeline/);
});

test("composition root owns concrete command wiring", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "src", "composition", "cli_application.js"),
    "utf8",
  );
  assert.match(source, /createRunDailyPipeline/);
  assert.match(source, /createDailyCommand/);
  assert.match(source, /createRootRouter/);
  assert.match(source, /createCliApplication/);
});
'''
    (ROOT / "tests" / "cli-complete-architecture-boundary.test.js").write_text(
        architecture_test,
        encoding="utf-8",
    )

    report = [
        f"functions_total={len(functions)}",
        f"daily_reachable={len(reachable)}",
        f"daily_moved={len(moved_names)}",
        "daily_moved_names=" + ",".join(sorted(moved_names)),
        "daily_shared_helpers=" + ",".join(sorted(shared)),
        "daily_dependencies=" + ",".join(daily_dependencies),
        "router_dependencies=" + ",".join(router_dependencies),
    ]
    (ROOT / "REFACTOR_TRANSFORM_REPORT.txt").write_text("\n".join(report) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
