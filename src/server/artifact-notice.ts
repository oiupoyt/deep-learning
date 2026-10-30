export function artifactCompletionText(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.persisted !== true || typeof result.artifactId !== "string" || (result.kind !== "demo" && result.kind !== "visual") || typeof result.title !== "string") return null;
  const label = result.kind === "demo" ? "Interactive demo" : "Visual figure";
  return label + " \"" + result.title + "\" is saved in Learning > Diagrams.";
}
