"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { layoutFlow, type GraphInput, type GraphKind } from "./flow-graph";

const GLYPHS: Record<GraphKind, string> = {
  goal: "◎",
  agent: "▣",
  tool: "⬡",
  memory: "▤",
  gate: "◆"
};

const KIND_LABEL: Record<GraphKind, string> = {
  goal: "Goal",
  agent: "Agent",
  tool: "Tool",
  memory: "Memory",
  gate: "Gate"
};

const PAD = 24;
const FIT_MIN = 0.22; // fit may shrink this far to guarantee the whole graph is in-frame
const MIN_SCALE = 0.4; // manual zoom-out floor
const MAX_SCALE = 1.4;

// The signature element: a flow drawn as a connected node graph. Layout is
// computed; the whole graph fits-to-view on load and on plan change (no
// horizontal scroll required), with optional pan/zoom and a fit control.
export function FlowGraph({
  input,
  selectedId,
  onSelect,
  readOnly = false,
  animate = false
}: {
  input: GraphInput;
  selectedId?: string;
  onSelect?: (id: string) => void;
  readOnly?: boolean;
  animate?: boolean;
}) {
  const { nodes, edges, width, height } = layoutFlow(input);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: PAD, y: PAD });
  const interactedRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (!vw || !vh) return;
    const raw = Math.min((vw - PAD * 2) / width, (vh - PAD * 2) / height, 1);
    const scale = Math.max(FIT_MIN, Math.min(raw, 1));
    setView({
      scale,
      x: Math.max(PAD, (vw - width * scale) / 2),
      y: Math.max(PAD, (vh - height * scale) / 2)
    });
  }, [width, height]);

  // Fit on mount and whenever the graph dimensions change (new plan).
  useEffect(() => {
    interactedRef.current = false;
    fit();
  }, [fit]);

  // Refit on container resize unless the user has taken manual control.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!interactedRef.current) fit();
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fit]);

  const zoomBy = (factor: number) => {
    interactedRef.current = true;
    setView((v) => {
      const vp = viewportRef.current;
      const cx = (vp?.clientWidth ?? width) / 2;
      const cy = (vp?.clientHeight ?? height) / 2;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      // Keep the viewport center fixed while zooming.
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  const onWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return; // plain scroll passes through
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.08 : 0.92);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest(".fgNode")) return; // don't pan when clicking a node
    interactedRef.current = true;
    panRef.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    setView((v) => ({ ...v, x: p.ox + (event.clientX - p.x), y: p.oy + (event.clientY - p.y) }));
  };

  const endPan = () => {
    panRef.current = null;
  };

  // Reveal order = spine position (x) then vertical (y) for the staged reveal.
  const order = new Map<string, number>();
  [...nodes].sort((a, b) => a.x - b.x || a.y - b.y).forEach((node, index) => order.set(node.id, index));
  const STEP = 90;

  return (
    <div
      className="flowGraph"
      ref={viewportRef}
      role="group"
      aria-label="Flow graph"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
    >
      <div
        className="flowGraphCanvas"
        style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <svg className="flowGraphEdges" width={width} height={height} aria-hidden>
          {edges.map((edge, index) => (
            <path
              key={edge.id}
              d={edge.d}
              className={`flowEdge edge-${edge.tone}${animate ? " edgeReveal" : ""}`}
              style={animate ? { animationDelay: `${(index + 1) * STEP}ms` } : undefined}
              fill="none"
            />
          ))}
        </svg>
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`fgNode node-${node.kind} tone-${node.tone}${selectedId === node.id ? " selected" : ""}`}
            style={{
              left: node.x,
              top: node.y,
              width: node.w,
              height: node.h,
              ...(animate ? { animationDelay: `${(order.get(node.id) ?? 0) * STEP}ms` } : {})
            }}
            onClick={() => onSelect?.(node.id)}
            disabled={readOnly && !onSelect}
            aria-label={`${KIND_LABEL[node.kind]}: ${node.title}${node.subtitle ? `, ${node.subtitle}` : ""}`}
            aria-pressed={selectedId === node.id}
          >
            <span className="flowNodeGlyph" aria-hidden>{GLYPHS[node.kind]}</span>
            <span className="flowNodeBody">
              <span className="flowNodeTitle" title={node.title}>{node.title}</span>
              {node.subtitle && <span className="flowNodeSub" title={node.subtitle}>{node.subtitle}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="flowGraphControls" aria-hidden>
        <button type="button" className="fgCtl" onClick={() => zoomBy(1.15)} title="Zoom in">+</button>
        <button type="button" className="fgCtl" onClick={() => zoomBy(0.87)} title="Zoom out">−</button>
        <button type="button" className="fgCtl" onClick={() => { interactedRef.current = false; fit(); }} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}
