import type { GraphNode, GraphEdge } from "../views/graph.ts";

export type GraphState = {
  graphLoading: boolean;
  graphError: string | null;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphSelectedNode: string | null;
  graphSelectedContent: string | null;
  graphShowConfigFiles: boolean;
};

type MemoryFile = {
  path: string;
  name: string;
  content: string;
  mtime: number;
};

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const MDLINK_RE = /\[([^\]]*)\]\(([^)]+\.md)\)/g;

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

function resolveLink(link: string, files: Map<string, MemoryFile>): string | null {
  // Try exact match first
  if (files.has(link)) return link;

  // Try adding .md
  const withMd = link.endsWith(".md") ? link : `${link}.md`;

  // Search by filename
  for (const [path, file] of files) {
    if (file.name === link || path.endsWith(`/${withMd}`) || path.endsWith(`/${link}`)) {
      return path;
    }
  }
  return null;
}

export function parseGraph(rawFiles: MemoryFile[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const fileMap = new Map<string, MemoryFile>();
  for (const f of rawFiles) {
    fileMap.set(f.path, f);
  }

  const linkCounts = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const file of rawFiles) {
    // Extract [[wikilinks]]
    let match: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(file.content)) !== null) {
      const target = resolveLink(match[1].trim(), fileMap);
      if (target && target !== file.path) {
        const edgeKey = [file.path, target].sort().join("|");
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          edges.push({ source: file.path, target, type: "wikilink" });
          linkCounts.set(file.path, (linkCounts.get(file.path) ?? 0) + 1);
          linkCounts.set(target, (linkCounts.get(target) ?? 0) + 1);
        }
      }
    }

    // Extract [text](path.md) links
    MDLINK_RE.lastIndex = 0;
    while ((match = MDLINK_RE.exec(file.content)) !== null) {
      const target = resolveLink(match[2].trim(), fileMap);
      if (target && target !== file.path) {
        const edgeKey = [file.path, target].sort().join("|");
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          edges.push({ source: file.path, target, type: "mdlink" });
          linkCounts.set(file.path, (linkCounts.get(file.path) ?? 0) + 1);
          linkCounts.set(target, (linkCounts.get(target) ?? 0) + 1);
        }
      }
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
  // Content is already in the initial fetch, find it from cache
  // If we need fresh content, fetch individual file
  try {
    const res = await fetch(`${apiBase}/api/memory/files`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data: { files: MemoryFile[] } = await res.json();
    const file = data.files.find((f) => f.path === nodeId);
    state.graphSelectedNode = nodeId;
    state.graphSelectedContent = file?.content ?? "File not found";
  } catch {
    state.graphSelectedContent = "Failed to load file content";
  }
}
