import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export type ArtifactKind = "demo" | "visual";

export interface LearningArtifact {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  notes: string;
  createdAt: string;
}

export interface NewLearningArtifact {
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  notes?: string;
}

const MAX_CONTENT = 256_000;
const MAX_TITLE = 200;
const MAX_NOTES = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKind(value: unknown): value is ArtifactKind {
  return value === "demo" || value === "visual";
}

function parseArtifact(value: unknown): LearningArtifact | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.sessionId !== "string" || !isKind(value.kind) || typeof value.title !== "string" || typeof value.content !== "string" || typeof value.notes !== "string" || typeof value.createdAt !== "string") return null;
  return {
    id: value.id,
    sessionId: value.sessionId,
    kind: value.kind,
    title: value.title,
    content: value.content,
    notes: value.notes,
    createdAt: value.createdAt,
  };
}

export function artifactInputFromRoleResult(sessionId: string, role: string, result: unknown): NewLearningArtifact | null {
  if (!isRecord(result) || !sessionId.trim()) return null;
  if (role === "demo" && typeof result.title === "string" && typeof result.html === "string" && result.html.length > 0 && (result.notes === undefined || typeof result.notes === "string")) {
    return { sessionId, kind: "demo", title: result.title, content: result.html, notes: result.notes ?? "" };
  }
  if (role === "visual" && typeof result.svg === "string" && result.svg.length > 0 && (result.notes === undefined || typeof result.notes === "string")) {
    return { sessionId, kind: "visual", title: "Visual figure", content: result.svg, notes: result.notes ?? "" };
  }
  return null;
}

export class FsArtifactStore {
  private readonly file: string;

  constructor(root: string) {
    this.file = path.join(root, "artifacts.jsonl");
  }

  save(input: NewLearningArtifact): LearningArtifact {
    if (!input.sessionId.trim() || !isKind(input.kind) || !input.title.trim() || !input.content || input.content.length > MAX_CONTENT) throw new Error("Invalid learning artifact.");
    if (input.title.length > MAX_TITLE || (input.notes ?? "").length > MAX_NOTES) throw new Error("Learning artifact metadata is too long.");
    const artifact: LearningArtifact = {
      id: randomUUID(),
      sessionId: input.sessionId,
      kind: input.kind,
      title: input.title.trim(),
      content: input.content,
      notes: input.notes ?? "",
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(artifact) + "\n", "utf8");
    return artifact;
  }

  list(sessionId?: string): LearningArtifact[] {
    let raw: string;
    try { raw = fs.readFileSync(this.file, "utf8"); } catch { return []; }
    const artifacts: LearningArtifact[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const artifact = parseArtifact(JSON.parse(line) as unknown);
        if (artifact && (sessionId === undefined || artifact.sessionId === sessionId)) artifacts.push(artifact);
      } catch { /* ignore a damaged append; later records remain readable */ }
    }
    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
