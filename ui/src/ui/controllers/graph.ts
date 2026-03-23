import type { GraphNode, GraphEdge } from "../views/graph.ts";

export type GraphState = {
  graphLoading: boolean;
  graphError: string | null;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphSelectedNode: string | null;
  graphSelectedContent: string | null;
  graphShowConfigFiles: boolean;
  graphEditMode: boolean;
  graphEditDraft: string | null;
  graphSaving: boolean;
  graphSaveError: string | null;
};

type MemoryFile = {
  path: string;
  name: string;
  content: string;
  mtime: number;
};

// Three link patterns found in real data:
// 1. [[wikilinks]] and [[link|alias]]
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
// 2. [text](path.md) standard markdown links to .md files
const MDLINK_RE = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
// 3. Bare .md references: MEMORY.md, memory/2026-03-22.md, IDENTITY.md
//    Must be preceded by whitespace/start-of-line and followed by whitespace/end/punctuation
const BARE_MD_RE = /(?:^|[\s(,])([A-Za-z0-9_/.:-]+\.md)(?=[\s),.:;]|$)/gm;

const CONFIG_FILES = new Set([
  "AGENTS",
  "TOOLS",
  "IDENTITY",
  "SOUL",
  "USER",
  "HEARTBEAT",
  "BOOTSTRAP",
]);

function classifyFile(name: string): GraphNode["group"] {
  if (name === "MEMORY" || name === "memory") return "index";
  if (CONFIG_FILES.has(name)) return "config";
  return "memory";
}

/** Build lookup indices for resolving link targets to file paths. */
function buildLookup(files: Map<string, MemoryFile>) {
  // Index by basename (e.g. "MEMORY.md" → "agent/MEMORY.md")
  const byBasename = new Map<string, string[]>();
  // Index by relative path within agent (e.g. "memory/2026-03-22.md")
  const byRelative = new Map<string, string[]>();

  for (const [fullPath] of files) {
    const parts = fullPath.split("/");
    const basename = parts[parts.length - 1];
    const relative = parts.slice(1).join("/"); // strip agent prefix

    const bl = byBasename.get(basename) ?? [];
    bl.push(fullPath);
    byBasename.set(basename, bl);

    const rl = byRelative.get(relative) ?? [];
    rl.push(fullPath);
    byRelative.set(relative, rl);
  }

  return { byBasename, byRelative };
}

function resolveLink(
  link: string,
  sourceAgent: string,
  files: Map<string, MemoryFile>,
  lookup: ReturnType<typeof buildLookup>,
): string | null {
  // Strip [[alias|display]] format
  const cleaned = link.split("|")[0].trim();
  if (!cleaned) return null;

  const withMd = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;

  // 1. Exact full path match
  if (files.has(cleaned)) return cleaned;
  if (files.has(withMd)) return withMd;

  // 2. Try as relative path within same agent: "agent/link"
  const agentRelative = `${sourceAgent}/${withMd}`;
  if (files.has(agentRelative)) return agentRelative;

  // 3. Match by relative path (e.g. "memory/2026-03-22.md")
  const byRel = lookup.byRelative.get(withMd);
  if (byRel) {
    // Prefer same agent
    const sameAgent = byRel.find((p) => p.startsWith(`${sourceAgent}/`));
    if (sameAgent) return sameAgent;
    return byRel[0];
  }

  // 4. Match by basename (e.g. "MEMORY.md")
  const byBase = lookup.byBasename.get(withMd);
  if (byBase) {
    const sameAgent = byBase.find((p) => p.startsWith(`${sourceAgent}/`));
    if (sameAgent) return sameAgent;
    return byBase[0];
  }

  return null;
}

function addEdge(
  source: string,
  target: string,
  type: GraphEdge["type"],
  edges: GraphEdge[],
  seen: Set<string>,
  linkCounts: Map<string, number>,
) {
  if (target === source) return;
  const edgeKey = [source, target].sort().join("|");
  if (seen.has(edgeKey)) return;
  seen.add(edgeKey);
  edges.push({ source, target, type });
  linkCounts.set(source, (linkCounts.get(source) ?? 0) + 1);
  linkCounts.set(target, (linkCounts.get(target) ?? 0) + 1);
}

export function parseGraph(rawFiles: MemoryFile[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const fileMap = new Map<string, MemoryFile>();
  for (const f of rawFiles) {
    fileMap.set(f.path, f);
  }
  const lookup = buildLookup(fileMap);

  const linkCounts = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const file of rawFiles) {
    const sourceAgent = file.path.split("/")[0];
    let match: RegExpExecArray | null;

    // 1. [[wikilinks]]
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(file.content)) !== null) {
      const target = resolveLink(match[1], sourceAgent, fileMap, lookup);
      if (target) addEdge(file.path, target, "wikilink", edges, seen, linkCounts);
    }

    // 2. [text](path.md) markdown links
    MDLINK_RE.lastIndex = 0;
    while ((match = MDLINK_RE.exec(file.content)) !== null) {
      const href = match[2].trim();
      // Skip URLs and anchor-only links
      if (href.startsWith("http") || href.startsWith("#")) continue;
      const target = resolveLink(href, sourceAgent, fileMap, lookup);
      if (target) addEdge(file.path, target, "mdlink", edges, seen, linkCounts);
    }

    // 3. Bare .md references (e.g. "MEMORY.md", "memory/2026-03-22.md")
    BARE_MD_RE.lastIndex = 0;
    while ((match = BARE_MD_RE.exec(file.content)) !== null) {
      const ref = match[1].trim();
      // Skip URLs, template patterns like YYYY-MM-DD.md
      if (ref.includes("://") || ref.includes("YYYY")) continue;
      const target = resolveLink(ref, sourceAgent, fileMap, lookup);
      if (target) addEdge(file.path, target, "mdlink", edges, seen, linkCounts);
    }
  }

  const nodes: GraphNode[] = rawFiles.map((f) => ({
    id: f.path,
    label: f.name,
    group: classifyFile(f.name),
    linkCount: linkCounts.get(f.path) ?? 0,
  }));

  return { nodes, edges };
}

// Cache fetched files to avoid re-fetching for node content preview
let _cachedFiles: MemoryFile[] | null = null;

export async function loadGraphData(
  state: GraphState,
  apiBase: string,
): Promise<void> {
  if (state.graphLoading) return;

  state.graphLoading = true;
  state.graphError = null;

  try {
    const res = await fetch(`${apiBase}/api/memory/files`);

    if (!res.ok) {
      throw new Error(`Memory API returned ${res.status}`);
    }

    const data: { files: MemoryFile[] } = await res.json();
    _cachedFiles = data.files;
    const { nodes, edges } = parseGraph(data.files);

    state.graphNodes = nodes;
    state.graphEdges = edges;
  } catch (err) {
    state.graphError = err instanceof Error ? err.message : String(err);
  } finally {
    state.graphLoading = false;
  }
}

export async function loadNodeContent(
  state: GraphState,
  nodeId: string,
  apiBase: string,
): Promise<void> {
  state.graphSelectedNode = nodeId;

  // Use cached files if available
  if (_cachedFiles) {
    const file = _cachedFiles.find((f) => f.path === nodeId);
    state.graphSelectedContent = file?.content ?? "File not found";
    return;
  }

  // Fallback: fetch fresh
  try {
    const res = await fetch(`${apiBase}/api/memory/files`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data: { files: MemoryFile[] } = await res.json();
    _cachedFiles = data.files;
    const file = data.files.find((f) => f.path === nodeId);
    state.graphSelectedContent = file?.content ?? "File not found";
  } catch {
    state.graphSelectedContent = "Failed to load file content";
  }
}

export async function saveNodeContent(
  state: GraphState,
  apiBase: string,
): Promise<boolean> {
  const nodeId = state.graphSelectedNode;
  const content = state.graphEditDraft;
  if (!nodeId || content === null) return false;

  state.graphSaving = true;
  state.graphSaveError = null;

  try {
    const res = await fetch(`${apiBase}/api/memory/files/${nodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }

    // Update cache
    if (_cachedFiles) {
      const idx = _cachedFiles.findIndex((f) => f.path === nodeId);
      if (idx >= 0) {
        _cachedFiles[idx] = { ..._cachedFiles[idx], content };
      }
    }

    state.graphSelectedContent = content;
    state.graphEditMode = false;
    state.graphEditDraft = null;
    return true;
  } catch (err) {
    state.graphSaveError = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    state.graphSaving = false;
  }
}
