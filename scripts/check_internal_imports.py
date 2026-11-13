"""Check that imports between local app modules name existing exports.

This is a static guard for mistakes such as importing an exception from the
wrong service module. It deliberately leaves third-party imports to the
packaging/runtime checks.
"""

from __future__ import annotations

import ast
from pathlib import Path


APP = Path(__file__).resolve().parents[1] / "app"


def module_name(path: Path) -> str:
    parts = path.relative_to(APP).with_suffix("").parts
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def exported_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()

    def targets(target: ast.expr) -> None:
        if isinstance(target, ast.Name):
            names.add(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for item in target.elts:
                targets(item)

    def visit(statements: list[ast.stmt]) -> None:
        for statement in statements:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(statement.name)
            elif isinstance(statement, ast.Assign):
                for target in statement.targets:
                    targets(target)
            elif isinstance(statement, ast.AnnAssign):
                targets(statement.target)
            elif isinstance(statement, ast.Import):
                for alias in statement.names:
                    names.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(statement, ast.ImportFrom):
                for alias in statement.names:
                    if alias.name != "*":
                        names.add(alias.asname or alias.name)
            elif isinstance(statement, (ast.If, ast.Try, ast.TryStar)):
                visit(statement.body)
                visit(statement.orelse)
                if isinstance(statement, (ast.Try, ast.TryStar)):
                    for handler in statement.handlers:
                        visit(handler.body)
                    visit(statement.finalbody)
            elif isinstance(statement, (ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith)):
                visit(statement.body)
                if hasattr(statement, "orelse"):
                    visit(statement.orelse)

    visit(tree.body)
    return names


def resolve_relative(module: str, is_package: bool, level: int, target: str | None) -> str:
    package = module.split(".") if is_package else module.split(".")[:-1]
    remaining = package[: len(package) - level + 1]
    if target:
        remaining.extend(target.split("."))
    return ".".join(remaining)


def main() -> int:
    files = list(APP.rglob("*.py"))
    modules: dict[str, tuple[Path, ast.Module]] = {}
    for path in files:
        name = module_name(path)
        if not name:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        modules[name] = (path, tree)
        modules["app." + name] = (path, tree)
    for path in APP.rglob("*"):
        if not path.is_dir():
            continue
        name = ".".join(path.relative_to(APP).parts)
        if name and name not in modules:
            empty = ast.Module(body=[], type_ignores=[])
            modules[name] = (path, empty)
            modules["app." + name] = (path, empty)
    exports = {name: exported_names(tree) for name, (_, tree) in modules.items()}
    prefixes = {name.split(".")[0] for name in modules}
    issues: list[str] = []

    for name, (path, tree) in modules.items():
        if name.startswith("app."):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target = alias.name
                    if target.split(".")[0] in prefixes and target not in modules:
                        issues.append(f"{path}:{node.lineno}: missing module {target}")
            elif isinstance(node, ast.ImportFrom):
                target = (
                    resolve_relative(name, path.is_dir() or path.name == "__init__.py", node.level, node.module)
                    if node.level else (node.module or "")
                )
                if target.split(".")[0] not in prefixes:
                    continue
                if target not in modules:
                    issues.append(f"{path}:{node.lineno}: missing module {target}")
                    continue
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    if alias.name not in exports[target] and target + "." + alias.name not in modules:
                        issues.append(f"{path}:{node.lineno}: {target} has no {alias.name}")

    for issue in sorted(set(issues)):
        print(issue)
    print(f"Checked {len(files)} Python files; {len(set(issues))} internal import issue(s).")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
