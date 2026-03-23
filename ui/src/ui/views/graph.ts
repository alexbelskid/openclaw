import { html, nothing, LitElement, css } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import * as d3 from "d3";
import { Marked } from "marked";

// ── Types ──────────────────────────────────────────────────────

export type GraphNode = {
  id: string;
  label: string;
  group: "memory" | "index" | "config";
  linkCount: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
};

export type GraphEdge = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: "wikilink" | "mdlink";
};

export type GraphViewProps = {
  loading: boolean;
  error: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: string | null;
  selectedContent: string | null;
  showConfigFiles: boolean;
  editMode: boolean;
  editDraft: string | null;
  saving: boolean;
  saveError: string | null;
  onSelectNode: (id: string) => void;
  onClosePreview: () => void;
  onRefresh: () => void;
  onToggleConfigFiles: () => void;
  onToggleEditMode: () => void;
  onEditChange: (content: string) => void;
  onSave: () => void;
};

// ── Color & sizing helpers ─────────────────────────────────────

const GROUP_COLORS: Record<GraphNode["group"], string> = {
  index: "#ff5c5c",
  memory: "#14b8a6",
  config: "#6b7280",
};

function nodeRadius(n: GraphNode): number {
  if (n.group === "index") return 14;
  return Math.max(6, Math.min(12, 6 + n.linkCount * 2));
}

// ── Markdown renderer (singleton) ──────────────────────────────

const marked = new Marked();

// ── d3 Canvas (LitElement with lifecycle) ──────────────────────

@customElement("belagent-graph-canvas")
export class BelagentGraphCanvas extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;

  @property({ type: Array }) nodes: GraphNode[] = [];
  @property({ type: Array }) edges: GraphEdge[] = [];
  @property({ type: String }) selectedNode: string | null = null;

  @query("svg") private svgEl!: SVGSVGElement;

  private _initialized = false;
  private _prevNodesJson = "";
  private _prevEdgesJson = "";
  private _simulation: d3.Simulation<GraphNode, GraphEdge> | null = null;
  private _resizeObserver: ResizeObserver | null = null;

  override render() {
    return html`<svg></svg>`;
  }

  override updated(changed: Map<string, unknown>) {
    if (!this.svgEl) return;

    // Only rebuild graph if actual data changed (not just reference)
    const nodesJson = JSON.stringify(this.nodes.map((n) => n.id).sort());
    const edgesJson = JSON.stringify(
      this.edges.map((e) => `${typeof e.source === "object" ? e.source.id : e.source}-${typeof e.target === "object" ? e.target.id : e.target}`).sort(),
    );
    const dataChanged = nodesJson !== this._prevNodesJson || edgesJson !== this._prevEdgesJson;

    if (dataChanged || !this._initialized) {
      this._prevNodesJson = nodesJson;
      this._prevEdgesJson = edgesJson;
      this._initGraph();
      this._initialized = true;
    } else if (changed.has("selectedNode")) {
      this._updateSelection();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._simulation?.stop();
    this._simulation = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  private _initGraph() {
    const svg = d3.select(this.svgEl);
    svg.selectAll("*").remove();

    const rect = this.svgEl.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;

    // Deep-copy nodes/edges so d3 can mutate positions
    const nodes: GraphNode[] = this.nodes.map((n) => ({ ...n }));
    const edges: GraphEdge[] = this.edges.map((e) => ({ ...e }));

    // SVG defs for glow filter
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Container for zoom/pan
    const g = svg.append("g");

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Center initially
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2),
    );

    // Force simulation — pre-compute layout silently, then keep alive for drag
    this._simulation?.stop();
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(100),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 4))
      .stop(); // don't auto-run yet

    // Pre-compute 500 ticks silently (no DOM updates)
    for (let i = 0; i < 500; i++) simulation.tick();

    this._simulation = simulation;

    // Edges — render at pre-computed positions
    const link = g
      .append("g")
      .attr("class", "edges")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#2e3040")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1)
      .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
      .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
      .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
      .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

    // Node groups — render at pre-computed positions
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            // Keep node fixed at drop position
            d.fx = d.x;
            d.fy = d.y;
          }),
      );

    // Tick handler — active for drag physics, dormant otherwise
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => GROUP_COLORS[d.group])
      .attr("stroke", (d) => GROUP_COLORS[d.group])
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.4)
      .attr("filter", "url(#glow)")
      .attr("opacity", 0.9);

    // Labels
    node
      .append("text")
      .text((d) => d.label)
      .attr("x", (d) => nodeRadius(d) + 6)
      .attr("y", 4)
      .attr("font-size", (d) => (d.group === "index" ? "12px" : "10px"))
      .attr("font-family", "inherit")
      .attr("fill", "#d4d4d8")
      .attr("fill-opacity", 0.8)
      .attr("pointer-events", "none");

    // Click handler
    node.on("click", (_event, d) => {
      this.dispatchEvent(
        new CustomEvent("node-select", { detail: d.id, bubbles: true, composed: true }),
      );
    });

    // Hover effects
    node
      .on("mouseenter", function (_event, d) {
        d3.select(this).select("circle").attr("opacity", 1).attr("stroke-width", 3);
        d3.select(this).select("text").attr("fill-opacity", 1);

        link
          .attr("stroke-opacity", (l) => {
            const src = typeof l.source === "object" ? l.source.id : l.source;
            const tgt = typeof l.target === "object" ? l.target.id : l.target;
            return src === d.id || tgt === d.id ? 0.9 : 0.15;
          })
          .attr("stroke", (l) => {
            const src = typeof l.source === "object" ? l.source.id : l.source;
            const tgt = typeof l.target === "object" ? l.target.id : l.target;
            return src === d.id || tgt === d.id ? GROUP_COLORS[d.group] : "#2e3040";
          });
      })
      .on("mouseleave", function () {
        d3.select(this).select("circle").attr("opacity", 0.9).attr("stroke-width", 1.5);
        d3.select(this).select("text").attr("fill-opacity", 0.8);
        link.attr("stroke-opacity", 0.5).attr("stroke", "#2e3040");
      });

    // Update selection highlight
    this._updateSelection();
  }

  private _updateSelection() {
    const svg = d3.select(this.svgEl);
    const selected = this.selectedNode;

    svg.selectAll<SVGGElement, GraphNode>(".nodes g").each(function (d) {
      const isSelected = d.id === selected;
      d3.select(this)
        .select("circle")
        .attr("stroke-width", isSelected ? 4 : 1.5)
        .attr("stroke-opacity", isSelected ? 1 : 0.4);
    });
  }
}

// ── Render function (matches existing view pattern) ────────────

export function renderGraph(props: GraphViewProps) {
  const {
    loading,
    error,
    nodes,
    edges,
    selectedNode,
    selectedContent,
    showConfigFiles,
    editMode,
    editDraft,
    saving,
    saveError,
    onSelectNode,
    onClosePreview,
    onRefresh,
    onToggleConfigFiles,
    onToggleEditMode,
    onEditChange,
    onSave,
  } = props;

  const filteredNodes = showConfigFiles
    ? nodes
    : nodes.filter((n) => n.group !== "config");

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => {
    const src = typeof e.source === "object" ? e.source.id : e.source;
    const tgt = typeof e.target === "object" ? e.target.id : e.target;
    return filteredNodeIds.has(src) && filteredNodeIds.has(tgt);
  });

  const renderedContent = selectedContent
    ? marked.parse(selectedContent) as string
    : "";

  return html`
    <div class="graph-root">
      <style>
        .graph-root {
          display: flex;
          height: calc(100vh - 56px);
          overflow: hidden;
        }
        .graph-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          position: relative;
        }
        .graph-toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--c-border, #2a2a3d);
          background: var(--c-surface, #13131a);
        }
        .graph-title {
          font-size: 15px;
          font-weight: 700;
          flex: 1;
        }
        .graph-stats {
          font-size: 11px;
          color: var(--c-muted, #6b6b8a);
        }
        .graph-btn {
          background: var(--c-surface2, #1c1c27);
          border: 1px solid var(--c-border, #2a2a3d);
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 11px;
          cursor: pointer;
          color: var(--c-text, inherit);
          transition: border-color 0.15s;
        }
        .graph-btn:hover { border-color: var(--c-accent, #ff5c5c); }
        .graph-btn--active {
          border-color: var(--c-accent, #ff5c5c);
          background: rgba(255, 92, 92, 0.1);
        }
        .graph-canvas {
          flex: 1;
          background: var(--bg, #0e1015);
        }
        .graph-loading, .graph-error {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-size: 13px;
          color: var(--c-muted, #6b6b8a);
        }
        .graph-error { color: var(--destructive, #ef4444); }
        .graph-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 8px;
          color: var(--c-muted, #6b6b8a);
          font-size: 13px;
        }

        /* Side panel */
        .graph-panel {
          width: 360px;
          border-left: 1px solid var(--c-border, #2a2a3d);
          background: var(--c-surface, #13131a);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .graph-panel-header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--c-border, #2a2a3d);
          gap: 8px;
        }
        .graph-panel-title {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .graph-panel-close {
          background: none;
          border: none;
          color: var(--c-muted, #6b6b8a);
          cursor: pointer;
          font-size: 16px;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .graph-panel-close:hover { background: var(--c-surface2, #1c1c27); }
        .graph-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          font-size: 13px;
          line-height: 1.6;
          color: var(--c-text, #d4d4d8);
        }
        .graph-panel-body h1, .graph-panel-body h2, .graph-panel-body h3 {
          margin: 16px 0 8px;
          font-weight: 600;
        }
        .graph-panel-body h1 { font-size: 18px; }
        .graph-panel-body h2 { font-size: 15px; }
        .graph-panel-body h3 { font-size: 13px; }
        .graph-panel-body p { margin: 0 0 10px; }
        .graph-panel-body code {
          background: var(--c-surface2, #1c1c27);
          padding: 2px 5px;
          border-radius: 3px;
          font-size: 12px;
        }
        .graph-panel-body pre {
          background: var(--c-surface2, #1c1c27);
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 12px;
        }
        .graph-panel-body ul, .graph-panel-body ol {
          padding-left: 20px;
          margin: 0 0 10px;
        }
        .graph-panel-body a {
          color: var(--c-accent, #ff5c5c);
          text-decoration: none;
        }
        .graph-panel-body a:hover { text-decoration: underline; }

        /* Edit mode */
        .graph-panel-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--c-border, #2a2a3d);
        }
        .graph-panel-actions .graph-btn { font-size: 11px; }
        .graph-panel-save {
          background: var(--c-accent, #ff5c5c);
          border: none;
          border-radius: 6px;
          padding: 5px 12px;
          font-size: 11px;
          cursor: pointer;
          color: #fff;
          font-weight: 600;
        }
        .graph-panel-save:hover { opacity: 0.9; }
        .graph-panel-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .graph-panel-error {
          font-size: 11px;
          color: var(--destructive, #ef4444);
          padding: 0 16px 4px;
        }
        .graph-panel-textarea {
          flex: 1;
          width: 100%;
          box-sizing: border-box;
          background: var(--bg, #0e1015);
          color: var(--c-text, #d4d4d8);
          border: none;
          padding: 16px;
          font-size: 13px;
          font-family: monospace;
          line-height: 1.6;
          resize: none;
          outline: none;
        }

        /* Legend */
        .graph-legend {
          position: absolute;
          bottom: 12px;
          left: 12px;
          background: rgba(22, 25, 32, 0.9);
          border: 1px solid var(--c-border, #2a2a3d);
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          gap: 14px;
          font-size: 10px;
          color: var(--c-muted, #6b6b8a);
        }
        .graph-legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .graph-legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
      </style>

      <div class="graph-main">
        <div class="graph-toolbar">
          <div class="graph-title">Граф памяти</div>
          <div class="graph-stats">
            ${filteredNodes.length} файлов, ${filteredEdges.length} связей
          </div>
          <button
            class="graph-btn ${showConfigFiles ? "graph-btn--active" : ""}"
            @click=${onToggleConfigFiles}
          >
            ${showConfigFiles ? "Скрыть конфиг" : "Показать конфиг"}
          </button>
          <button class="graph-btn" @click=${onRefresh}>↻</button>
        </div>

        ${loading
          ? html`<div class="graph-loading">Загрузка графа...</div>`
          : error
            ? html`<div class="graph-error">${error}</div>`
            : filteredNodes.length === 0
              ? html`<div class="graph-empty">
                  <div>Нет файлов для отображения</div>
                  <button class="graph-btn" @click=${onRefresh}>Обновить</button>
                </div>`
              : html`
                  <belagent-graph-canvas
                    class="graph-canvas"
                    .nodes=${filteredNodes}
                    .edges=${filteredEdges}
                    .selectedNode=${selectedNode}
                    @node-select=${(e: CustomEvent) => onSelectNode(e.detail)}
                  ></belagent-graph-canvas>
                  <div class="graph-legend">
                    <div class="graph-legend-item">
                      <div class="graph-legend-dot" style="background: #ff5c5c;"></div>
                      Индекс
                    </div>
                    <div class="graph-legend-item">
                      <div class="graph-legend-dot" style="background: #14b8a6;"></div>
                      Память
                    </div>
                    ${showConfigFiles
                      ? html`
                          <div class="graph-legend-item">
                            <div class="graph-legend-dot" style="background: #6b7280;"></div>
                            Конфиг
                          </div>
                        `
                      : nothing}
                  </div>
                `
        }
      </div>

      ${selectedNode
        ? html`
            <div class="graph-panel">
              <div class="graph-panel-header">
                <div class="graph-panel-title">
                  ${nodes.find((n) => n.id === selectedNode)?.label ?? selectedNode}
                </div>
                <button class="graph-panel-close" @click=${onClosePreview}>✕</button>
              </div>
              <div class="graph-panel-actions">
                <button
                  class="graph-btn ${!editMode ? "graph-btn--active" : ""}"
                  @click=${() => { if (editMode) onToggleEditMode(); }}
                >Просмотр</button>
                <button
                  class="graph-btn ${editMode ? "graph-btn--active" : ""}"
                  @click=${() => { if (!editMode) onToggleEditMode(); }}
                >Редактор</button>
                ${editMode
                  ? html`<button
                      class="graph-panel-save"
                      ?disabled=${saving}
                      @click=${onSave}
                    >${saving ? "Сохранение..." : "Сохранить"}</button>`
                  : nothing}
              </div>
              ${saveError ? html`<div class="graph-panel-error">${saveError}</div>` : nothing}
              ${editMode
                ? html`<textarea
                    class="graph-panel-textarea"
                    .value=${editDraft ?? selectedContent ?? ""}
                    @input=${(e: Event) => onEditChange((e.target as HTMLTextAreaElement).value)}
                  ></textarea>`
                : html`<div class="graph-panel-body" .innerHTML=${renderedContent}></div>`}
            </div>
          `
        : nothing}
    </div>
  `;
}
