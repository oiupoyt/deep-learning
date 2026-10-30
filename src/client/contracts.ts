import type { LearningArtifact, ArtifactKind } from "../store/artifacts.js";

export interface SnapshotNode {
  id: string;
  name: string;
  statement: string;
  aliases: string[];
  createdAt: string;
  provenance: Array<{ chatId: string; messageId: string }>;
}

export interface SnapshotChain {
  id: string;
  premises: string[];
  conclusion: string;
  provenance: Array<{ chatId: string; messageId: string }>;
  createdAt: string;
}

export interface Snapshot {
  nodes: SnapshotNode[];
  propositions: SnapshotNode[];
  edges: Array<{ from: string; to: string }>;
  chains: SnapshotChain[];
  sessions: Record<string, string>;
  fileSources: Record<string, string>;
  logicalEdges?: Array<{ from: string; to: string }>;
  impLinks?: Array<{ id: string; premises: string[]; conclusion: string }>;
  nodeSessions?: Record<string, string[]>;
  clusters?: Array<{ id: string; label: string | null; members: string[] }>;
  positions?: Record<string, { x: number; y: number }>;
}

const MAX_CONTENT = 256_000;
const MAX_TITLE = 200;
const MAX_NOTES = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string { return typeof value === "string"; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every(isString); }
function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}
function isStringArrayMap(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}
function isPoint(value: unknown): value is { chatId: string; messageId: string } {
  return isRecord(value) && isString(value.chatId) && isString(value.messageId);
}
function isNode(value: unknown): value is SnapshotNode {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.statement) &&
    isStringArray(value.aliases) && isString(value.createdAt) && Array.isArray(value.provenance) && value.provenance.every(isPoint);
}
function isEdge(value: unknown): value is { from: string; to: string } {
  return isRecord(value) && isString(value.from) && isString(value.to);
}
function isChain(value: unknown): value is SnapshotChain {
  return isRecord(value) && isString(value.id) && isStringArray(value.premises) && isString(value.conclusion) &&
    Array.isArray(value.provenance) && value.provenance.every(isPoint) && isString(value.createdAt);
}

export function parseSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !value.nodes.every(isNode) ||
      !Array.isArray(value.propositions) || !value.propositions.every(isNode) ||
      !Array.isArray(value.edges) || !value.edges.every(isEdge) ||
      !Array.isArray(value.chains) || !value.chains.every(isChain) ||
      !isStringMap(value.sessions) || !isStringMap(value.fileSources)) return null;
  if (value.logicalEdges !== undefined && (!Array.isArray(value.logicalEdges) || !value.logicalEdges.every(isEdge))) return null;
  if (value.impLinks !== undefined && (!Array.isArray(value.impLinks) || !value.impLinks.every((item) =>
    isRecord(item) && isString(item.id) && isStringArray(item.premises) && isString(item.conclusion)))) return null;
  if (value.nodeSessions !== undefined && !isStringArrayMap(value.nodeSessions)) return null;
  if (value.clusters !== undefined && (!Array.isArray(value.clusters) || !value.clusters.every((item) =>
    isRecord(item) && isString(item.id) && (item.label === null || isString(item.label)) && isStringArray(item.members)))) return null;
  if (value.positions !== undefined && (!isRecord(value.positions) || !Object.values(value.positions).every((item) =>
    isRecord(item) && typeof item.x === "number" && Number.isFinite(item.x) && typeof item.y === "number" && Number.isFinite(item.y)))) return null;
  return value as unknown as Snapshot;
}

function isArtifactKind(value: unknown): value is ArtifactKind { return value === "demo" || value === "visual"; }
function isArtifact(value: unknown): value is LearningArtifact {
  return isRecord(value) && isString(value.id) && isString(value.sessionId) && isArtifactKind(value.kind) &&
    isString(value.title) && value.title.length > 0 && value.title.length <= MAX_TITLE &&
    isString(value.content) && value.content.length > 0 && value.content.length <= MAX_CONTENT &&
    isString(value.notes) && value.notes.length <= MAX_NOTES && isString(value.createdAt);
}

export function parseArtifactsResponse(value: unknown): LearningArtifact[] | null {
  return Array.isArray(value) && value.every(isArtifact) ? value : null;
}
