#!/usr/bin/env python3
"""Read-only readers for the deep-learning plugin's knowledge graph.

Standard library only. No network, no writes, no app required.
Resolve paths against the data directory (default ~/.dsh/deep-learning);
pass --data-dir to select another copy. Readers print the selected
directory and never create anything.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _lines(path: Path):
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue  # torn line: skip, never guess
        if isinstance(value, dict):
            yield value


def _merged_nodes(data: Path):
    by_id: dict[str, dict] = {}
    for line in _lines(data / "graph" / "nodes.jsonl"):
        node_id = line.get("id")
        if not isinstance(node_id, str):
            continue
        existing = by_id.get(node_id)
        if existing is None:
            by_id[node_id] = {
                "id": node_id,
                "name": line.get("name", ""),
                "statement": line.get("statement", ""),
                "aliases": list(line.get("aliases", [])),
                "createdAt": line.get("createdAt", ""),
                "provenance": list(line.get("provenance", [])),
            }
            continue
        for phrasing in [line.get("statement", ""), *line.get("aliases", [])]:
            if phrasing and phrasing not in existing["aliases"]:
                existing["aliases"].append(phrasing)
        for point in line.get("provenance", []):
            if point not in existing["provenance"]:
                existing["provenance"].append(point)
    return list(by_id.values())


def _merged_chains(data: Path):
    def key(chain: dict) -> tuple:
        return (tuple(sorted(chain.get("premises", []))), chain.get("conclusion", ""))

    by_key: dict[tuple, dict] = {}
    order: list[tuple] = []
    for line in _lines(data / "graph" / "chains.jsonl"):
        chain = {
            "id": line.get("id", ""),
            "premises": list(line.get("premises", [])),
            "conclusion": line.get("conclusion", ""),
            "createdAt": line.get("createdAt", ""),
            "provenance": list(line.get("provenance", [])),
        }
        k = key(chain)
        if k in by_key:
            for point in chain["provenance"]:
                if point not in by_key[k]["provenance"]:
                    by_key[k]["provenance"].append(point)
        else:
            by_key[k] = chain
            order.append(k)
    return [by_key[k] for k in order]


def _sources(data: Path) -> dict[str, str]:
    sources_file = data / "graph" / "sources.json"
    if not sources_file.is_file():
        return {}
    try:
        raw = json.loads(sources_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for source_id, value in raw.items():
        if isinstance(value, dict) and isinstance(value.get("filePath"), str):
            out[source_id] = value["filePath"]
    return out


def _birth_sessions(nodes: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in nodes:
        points = node.get("provenance") or []
        if points and isinstance(points[0], dict) and isinstance(points[0].get("chatId"), str):
            birth = points[0]["chatId"]
            counts[birth] = counts.get(birth, 0) + 1
    return counts


def _label(session_id: str, sources: dict[str, str]) -> str:
    return sources.get(session_id, session_id)


def _print(value: object) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def _match(pattern: str, text: str) -> bool:
    parts = pattern.lower().split("*")
    text = text.lower()
    pos = 0
    for i, part in enumerate(parts):
        if not part:
            continue
        idx = text.find(part, pos)
        if idx < 0:
            return False
        if i == 0 and idx != 0 and pattern.startswith("*") is False and not pattern.startswith("*"):
            if idx != 0:
                return False
        pos = idx + len(part)
    if parts[-1] != "" and not text.endswith(parts[-1]):
        return False
    return True


def sessions(data: Path, args: argparse.Namespace) -> None:
    nodes = _merged_nodes(data)
    sources = _sources(data)
    counts = _birth_sessions(nodes)
    rows = [
        {"id": sid, "label": _label(sid, sources), "propositions": n}
        for sid, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    _print(rows)


def propositions(data: Path, args: argparse.Namespace) -> None:
    nodes = _merged_nodes(data)
    sources = _sources(data)
    rows = []
    for node in nodes:
        points = node.get("provenance") or []
        birth = points[0]["chatId"] if points and isinstance(points[0], dict) else None
        if args.session is not None and birth != args.session:
            continue
        rows.append(
            {
                "id": node["id"],
                "name": node["name"],
                "statement": node["statement"],
                "birthSession": birth,
                "birthLabel": _label(birth, sources) if birth else None,
            }
        )
    rows.sort(key=lambda r: r["id"])
    _print(rows)


def chains(data: Path, args: argparse.Namespace) -> None:
    nodes = _merged_nodes(data)
    chains_list = _merged_chains(data)
    names = {n["id"]: n["name"] for n in nodes}
    rows = []
    for chain in chains_list:
        if args.node is not None and args.node not in chain["premises"] and args.node != chain["conclusion"]:
            continue
        premise_names = ", ".join(sorted(names.get(p, p) for p in chain["premises"]))
        rows.append(
            {
                "id": chain["id"],
                "line": f"{premise_names} → {names.get(chain['conclusion'], chain['conclusion'])}",
                "premises": chain["premises"],
                "conclusion": chain["conclusion"],
            }
        )
    rows.sort(key=lambda r: r["id"])
    _print(rows)


def find(data: Path, args: argparse.Namespace) -> None:
    nodes = _merged_nodes(data)
    rows = []
    for node in nodes:
        haystacks = [node["name"], node["statement"], *node["aliases"]]
        if any(_match(args.pattern, h) for h in haystacks):
            rows.append({"id": node["id"], "name": node["name"], "statement": node["statement"]})
    rows.sort(key=lambda r: r["id"])
    _print(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read the deep-learning graph read-only.")
    parser.add_argument("--data-dir", default=str(Path.home() / ".dsh" / "deep-learning"), help="Data directory (default ~/.dsh/deep-learning)")
    parser.add_argument("--format", choices=("json", "text"), default="json", help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("sessions", help="Birth sessions of the graph's propositions.")
    p = sub.add_parser("propositions", help="Propositions, optionally one session's births.")
    p.add_argument("--session", help="Only propositions first born in this session.")
    sub.add_parser("chains", help="Reasoning chains.")
    p = sub.add_parser("chains_node", help=argparse.SUPPRESS)
    p = sub.add_parser("find", help="Substring/wildcard search over names, statements, aliases.")
    p.add_argument("pattern", help="Search pattern; * is the only wildcard. Quote it.")

    args = parser.parse_args(argv)
    data = Path(args.data_dir).expanduser()
    if not data.is_dir():
        print(f"data directory not found: {data}", file=sys.stderr)
        return 2
    if args.command == "chains" and not hasattr(args, "node"):
        args.node = None

    print(f"[deep-learning] data: {data}", file=sys.stderr)
    handlers = {
        "sessions": sessions,
        "propositions": propositions,
        "chains": chains,
        "chains_node": chains,
        "find": find,
    }
    handlers[args.command](data, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
