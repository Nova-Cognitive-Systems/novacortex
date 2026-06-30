"use client";

import { useEffect, useRef, useState } from "react";

// ── Seeded PRNG (reproducible graph layout) ──
let _s = 77;
function R() {
  _s = (_s * 16807) % 2147483647;
  return (_s - 1) / 2147483646;
}

// ── Node generation ──
type NodeData = { rx: number; ry: number; size: number; shape: "sq" | "ci"; layer: number };

function generateNodes(): NodeData[] {
  _s = 77; // reset seed each time
  const nodes: NodeData[] = [];

  // Layer 0: Core hub (30)
  for (let i = 0; i < 30; i++) {
    const a = R() * Math.PI * 2;
    const r = R() * 35;
    nodes.push({ rx: Math.cos(a) * r, ry: Math.sin(a) * r, size: 3 + R() * 3, shape: "sq", layer: 0 });
  }
  // Layer 1: Inner dense (120)
  for (let i = 0; i < 120; i++) {
    const a = R() * Math.PI * 2;
    const r = 25 + Math.pow(R(), 0.7) * 100;
    nodes.push({ rx: Math.cos(a) * r, ry: Math.sin(a) * r, size: 2 + R() * 2, shape: R() > 0.45 ? "sq" : "ci", layer: 1 });
  }
  // Layer 2: Mid ring (200)
  for (let i = 0; i < 200; i++) {
    const a = R() * Math.PI * 2;
    const r = 100 + Math.pow(R(), 0.6) * 180;
    nodes.push({ rx: Math.cos(a) * r + (R() - 0.5) * 40, ry: Math.sin(a) * r + (R() - 0.5) * 40, size: 1.8 + R() * 1.8, shape: R() > 0.5 ? "sq" : "ci", layer: 2 });
  }
  // Layer 3: Outer sparse (350)
  for (let i = 0; i < 350; i++) {
    const a = R() * Math.PI * 2;
    const r = 250 + Math.pow(R(), 0.45) * 250;
    nodes.push({ rx: Math.cos(a) * r + (R() - 0.5) * 50, ry: Math.sin(a) * r + (R() - 0.5) * 50, size: 1.5 + R() * 1.5, shape: R() > 0.5 ? "sq" : "ci", layer: 3 });
  }
  return nodes;
}

// ── Edge generation ──
function generateEdges(N: number): [number, number][] {
  _s = 77;
  generateNodes(); // advance seed to same state
  const edges: [number, number][] = [];

  // Core fully meshed
  for (let i = 0; i < 30; i++)
    for (let j = i + 1; j < 30; j++)
      if (R() < 0.55) edges.push([i, j]);

  // Core → inner
  for (let i = 30; i < 150; i++) {
    const n = 2 + Math.floor(R() * 3);
    for (let c = 0; c < n; c++) edges.push([i, Math.floor(R() * 30)]);
    if (R() < 0.4) { const o = 30 + Math.floor(R() * 120); if (o !== i) edges.push([i, o]); }
  }
  // Mid → inner/core
  for (let i = 150; i < 350; i++) {
    const n = 1 + Math.floor(R() * 2);
    for (let c = 0; c < n; c++) edges.push([i, Math.floor(R() * 150)]);
    if (R() < 0.2) { const o = 150 + Math.floor(R() * 200); if (o !== i) edges.push([i, o]); }
  }
  // Outer → mid/inner
  for (let i = 350; i < N; i++) {
    edges.push([i, Math.floor(R() * 350)]);
    if (R() < 0.3) edges.push([i, Math.floor(R() * 150)]);
    if (R() < 0.1) { const o = 350 + Math.floor(R() * 350); if (o !== i && o < N) edges.push([i, o]); }
  }
  // Long-range
  for (let i = 0; i < 200; i++) {
    const a = Math.floor(R() * N), b = Math.floor(R() * N);
    if (a !== b) edges.push([a, b]);
  }
  return edges;
}

const PROVIDERS = [
  { name: "OpenAI",     angle: -0.4,  dist: 0.36, color: "#00f0ff" },
  { name: "Anthropic",  angle: -1.2,  dist: 0.32, color: "#ff2d95" },
  { name: "Gemini",     angle: -2.1,  dist: 0.35, color: "#8b5cf6" },
  { name: "Mistral",    angle: -2.8,  dist: 0.38, color: "#00f0ff" },
  { name: "LangChain",  angle:  0.5,  dist: 0.34, color: "#ff2d95" },
  { name: "LlamaIndex", angle:  1.3,  dist: 0.36, color: "#8b5cf6" },
  { name: "CrewAI",     angle:  2.1,  dist: 0.33, color: "#00f0ff" },
  { name: "AutoGen",    angle:  2.9,  dist: 0.37, color: "#ff2d95" },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function HeroCanvases() {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<HTMLCanvasElement>(null);
  const [, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const bgCanvas = bgRef.current;
    const graphCanvas = graphRef.current;
    if (!bgCanvas || !graphCanvas) return;

    const bgCtx = bgCanvas.getContext("2d")!;
    const graphCtx = graphCanvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let W = 0, H = 0;
    let tronTime = 0;
    let frame = 0;
    let bgRaf: number, graphRaf: number;
    let offscreen: HTMLCanvasElement | null = null;

    const nodeData = generateNodes();
    const N = nodeData.length;
    const edgeData = generateEdges(N);

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      bgCanvas!.width = W * dpr; bgCanvas!.height = H * dpr;
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      graphCanvas!.width = W * dpr; graphCanvas!.height = H * dpr;
      graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGraphStatic();
    }

    // ── Tron Grid ──
    function drawTronGrid() {
      bgCtx.clearRect(0, 0, W, H);
      bgCtx.fillStyle = "#0a0e17";
      bgCtx.fillRect(0, 0, W, H);

      // Dot grid
      bgCtx.fillStyle = "rgba(60,120,140,0.05)";
      for (let x = 18; x < W; x += 26)
        for (let y = 18; y < H; y += 26)
          bgCtx.fillRect(x, y, 1, 1);

      const horizon = H * 0.35;
      const vx = W / 2;

      // Horizontal lines
      for (let i = 0; i < 28; i++) {
        const t = i / 28;
        const y = horizon + (H - horizon) * Math.pow(t, 1.4);
        const pulse = Math.sin(tronTime * 0.015 + i * 0.3) * 0.015;
        bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(W, y);
        bgCtx.strokeStyle = `rgba(0,240,255,${0.025 + 0.05 * t + pulse})`;
        bgCtx.lineWidth = 0.4; bgCtx.stroke();
      }
      // Vertical lines
      for (let i = -14; i <= 14; i++) {
        const bx = vx + i * 130;
        bgCtx.beginPath(); bgCtx.moveTo(vx, horizon); bgCtx.lineTo(bx, H);
        bgCtx.strokeStyle = `rgba(0,240,255,${0.02 + 0.025 * (1 - Math.abs(i) / 14)})`;
        bgCtx.lineWidth = 0.4; bgCtx.stroke();
      }
      // Horizon glow
      const hg = bgCtx.createRadialGradient(vx, horizon, 0, vx, horizon, 250);
      hg.addColorStop(0, "rgba(0,240,255,0.04)");
      hg.addColorStop(1, "transparent");
      bgCtx.fillStyle = hg; bgCtx.fillRect(vx - 250, horizon - 250, 500, 500);

      // Scanline
      const sy = (tronTime * 0.4) % H;
      bgCtx.beginPath(); bgCtx.moveTo(0, sy); bgCtx.lineTo(W, sy);
      bgCtx.strokeStyle = "rgba(0,240,255,0.02)"; bgCtx.lineWidth = 2; bgCtx.stroke();

      tronTime++;
      bgRaf = requestAnimationFrame(drawTronGrid);
    }

    // ── Static graph pre-render ──
    function drawGraphStatic() {
      offscreen = document.createElement("canvas");
      offscreen.width = W * dpr; offscreen.height = H * dpr;
      const oc = offscreen.getContext("2d")!;
      oc.setTransform(dpr, 0, 0, dpr, 0, 0);

      const CX = W / 2, CY = H / 2;
      const scale = Math.min(W, H) / 900;

      // Edges
      for (let i = 0; i < edgeData.length; i++) {
        const [ai, bi] = edgeData[i];
        const a = nodeData[ai], b = nodeData[bi];
        const ax = CX + a.rx * scale, ay = CY + a.ry * scale;
        const bx = CX + b.rx * scale, by = CY + b.ry * scale;
        const dx = bx - ax, dy = by - ay;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midDist = Math.sqrt(((ax + bx) / 2 - CX) ** 2 + ((ay + by) / 2 - CY) ** 2);
        const maxR = Math.min(W, H) * 0.45;
        const t = Math.min(midDist / maxR, 1);
        let al = 0.03 + (1 - t) * 0.14;
        if (dist > 400) al *= 0.5;
        const r = Math.floor(130 - 60 * t);
        const g = Math.floor(70 + 40 * t);
        const cb = Math.floor(210 + 30 * t);
        oc.beginPath(); oc.moveTo(ax, ay); oc.lineTo(bx, by);
        oc.strokeStyle = `rgba(${r},${g},${cb},${al})`;
        oc.lineWidth = al > 0.1 ? 0.6 : 0.4; oc.stroke();
      }

      // Provider connection lines
      for (const p of PROVIDERS) {
        const pr = Math.min(W, H) * p.dist;
        const px = CX + Math.cos(p.angle) * pr;
        const py = CY + Math.sin(p.angle) * pr;
        for (let c = 0; c < 5; c++) {
          const ni = Math.floor(R() * 150);
          const nd = nodeData[ni];
          const nx = CX + nd.rx * scale, ny = CY + nd.ry * scale;
          oc.beginPath(); oc.moveTo(px, py); oc.lineTo(nx, ny);
          oc.strokeStyle = hexToRgba(p.color, 0.12);
          oc.lineWidth = 0.8; oc.stroke();
        }
      }

      // Nodes
      for (let i = 0; i < N; i++) {
        const n = nodeData[i];
        const x = CX + n.rx * scale, y = CY + n.ry * scale;
        const s = n.size * (n.layer === 0 ? 1.2 : 1) * Math.min(scale, 1.2);

        if (n.layer === 0) {
          oc.beginPath(); oc.arc(x, y, s + 6, 0, Math.PI * 2);
          oc.fillStyle = "rgba(0,240,255,0.03)"; oc.fill();
        }

        if (n.shape === "sq") {
          const ss = s * 2;
          oc.fillStyle = "rgba(10,14,23,0.85)"; oc.fillRect(x - ss / 2, y - ss / 2, ss, ss);
          oc.strokeStyle = `rgba(0,220,240,${n.layer < 2 ? 0.5 : 0.3})`;
          oc.lineWidth = n.layer === 0 ? 1.2 : 0.6; oc.strokeRect(x - ss / 2, y - ss / 2, ss, ss);
          if (n.layer < 2) { oc.fillStyle = "rgba(0,240,255,0.25)"; oc.fillRect(x - 0.7, y - 0.7, 1.4, 1.4); }
        } else {
          oc.beginPath(); oc.arc(x, y, s, 0, Math.PI * 2);
          oc.fillStyle = "rgba(10,14,23,0.75)"; oc.fill();
          oc.strokeStyle = `rgba(0,210,230,${n.layer < 2 ? 0.5 : 0.3})`;
          oc.lineWidth = n.layer === 0 ? 1.2 : 0.6; oc.stroke();
          oc.beginPath(); oc.arc(x, y, s * 0.3, 0, Math.PI * 2);
          oc.fillStyle = "rgba(0,240,255,0.3)"; oc.fill();
        }
      }

      // Provider label nodes
      for (const p of PROVIDERS) {
        const pr = Math.min(W, H) * p.dist;
        const px = CX + Math.cos(p.angle) * pr;
        const py = CY + Math.sin(p.angle) * pr;
        const lg = oc.createRadialGradient(px, py, 0, px, py, 28);
        lg.addColorStop(0, hexToRgba(p.color, 0.08));
        lg.addColorStop(1, "transparent");
        oc.beginPath(); oc.arc(px, py, 28, 0, Math.PI * 2); oc.fillStyle = lg; oc.fill();
        oc.beginPath(); oc.arc(px, py, 20, 0, Math.PI * 2);
        oc.fillStyle = "rgba(10,14,23,0.9)"; oc.fill();
        oc.strokeStyle = p.color; oc.globalAlpha = 0.6; oc.lineWidth = 1.2; oc.stroke();
        oc.globalAlpha = 1;
        oc.beginPath(); oc.arc(px, py, 4, 0, Math.PI * 2);
        oc.fillStyle = p.color; oc.globalAlpha = 0.5; oc.fill(); oc.globalAlpha = 1;
        oc.font = "500 10px Outfit, sans-serif"; oc.textAlign = "center";
        oc.fillStyle = p.color; oc.globalAlpha = 0.7;
        oc.fillText(p.name, px, py + 34); oc.globalAlpha = 1;
      }
    }

    // ── Animated frame ──
    function renderAnimated() {
      graphCtx.clearRect(0, 0, W, H);
      if (offscreen) graphCtx.drawImage(offscreen, 0, 0, W, H);

      const CX = W / 2, CY = H / 2;
      const scale = Math.min(W, H) / 900;

      // Data flow particles
      for (let i = 0; i < edgeData.length; i += 6) {
        const [ai, bi] = edgeData[i];
        const a = nodeData[ai], b = nodeData[bi];
        const ax = CX + a.rx * scale, ay = CY + a.ry * scale;
        const bx = CX + b.rx * scale, by = CY + b.ry * scale;
        const t = ((frame * 0.005 + i * 0.05) % 1);
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        graphCtx.beginPath(); graphCtx.arc(px, py, 1, 0, Math.PI * 2);
        graphCtx.fillStyle = i % 18 === 0 ? "rgba(255,45,149,0.6)" : "rgba(0,240,255,0.45)";
        graphCtx.fill();
      }

      // Hub node pulses
      for (let i = 0; i < 30; i++) {
        const n = nodeData[i];
        const x = CX + n.rx * scale, y = CY + n.ry * scale;
        const pulse = Math.sin(frame * 0.025 + i * 0.5) * 0.5 + 0.5;
        const s = n.size * 1.2 * Math.min(scale, 1.2);
        graphCtx.beginPath(); graphCtx.arc(x, y, s + 4 + pulse * 4, 0, Math.PI * 2);
        graphCtx.fillStyle = `rgba(0,240,255,${0.01 + pulse * 0.02})`; graphCtx.fill();
      }

      // Provider pulse rings
      for (const p of PROVIDERS) {
        const pr = Math.min(W, H) * p.dist;
        const px = CX + Math.cos(p.angle) * pr;
        const py = CY + Math.sin(p.angle) * pr;
        const pulse = Math.sin(frame * 0.02 + p.angle * 2) * 0.5 + 0.5;
        graphCtx.beginPath(); graphCtx.arc(px, py, 22 + pulse * 4, 0, Math.PI * 2);
        graphCtx.strokeStyle = hexToRgba(p.color, 0.08 + pulse * 0.08);
        graphCtx.lineWidth = 0.5; graphCtx.stroke();
      }

      // CRT glitch slice
      if (Math.random() < 0.015) {
        const sliceY = Math.floor(Math.random() * H);
        const sliceH = 2 + Math.floor(Math.random() * 20);
        const shift = (Math.random() - 0.5) * 12;
        try {
          const img = graphCtx.getImageData(0, sliceY * dpr, W * dpr, sliceH * dpr);
          graphCtx.putImageData(img, shift * dpr, sliceY * dpr);
        } catch { /* cross-origin guard */ }
      }

      // Brightness flash
      if (Math.random() < 0.008) {
        graphCtx.fillStyle = "rgba(0,240,255,0.015)";
        graphCtx.fillRect(0, 0, W, H);
      }

      frame++;
      graphRaf = requestAnimationFrame(renderAnimated);
    }

    resize();
    drawTronGrid();
    renderAnimated();

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(bgRaf);
      cancelAnimationFrame(graphRaf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const canvasStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  };

  return (
    <>
      <canvas ref={bgRef} style={{ ...canvasStyle, zIndex: 1 }} aria-hidden="true" />
      <canvas ref={graphRef} style={{ ...canvasStyle, zIndex: 2 }} aria-hidden="true" />
    </>
  );
}

// ── Graph stats counter badges ──
export function GraphStats({ nodeCount, edgeCount }: { nodeCount: number; edgeCount: number }) {
  const [displayed, setDisplayed] = useState({ n: 0, e: 0 });

  useEffect(() => {
    if (nodeCount === 0) return;
    const dur = 2200;
    const start = performance.now();
    let raf: number;
    function tick(now: number) {
      const p = Math.min((now - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplayed({ n: Math.floor(e * nodeCount), e: Math.floor(e * edgeCount) });
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    const timeout = setTimeout(() => { raf = requestAnimationFrame(tick); }, 2000);
    return () => { clearTimeout(timeout); cancelAnimationFrame(raf); };
  }, [nodeCount, edgeCount]);

  const badge = (color: string, bg: string, border: string, text: string): React.CSSProperties => ({
    padding: "0.4rem 1rem",
    borderRadius: "8px",
    fontFamily: "'Chakra Petch', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
    letterSpacing: "0.03em",
    color,
    background: bg,
    border: `1px solid ${border}`,
  });

  return (
    <div
      style={{
        position: "absolute",
        top: "80px",
        left: "2rem",
        display: "flex",
        gap: "0.8rem",
        zIndex: 20,
        opacity: 0,
        animation: "nc-fadeIn 1s ease forwards 2s",
      }}
    >
      <div style={badge("#00f0ff", "rgba(0,240,255,0.1)", "rgba(0,240,255,0.2)", "")}>
        {displayed.n} Nodes
      </div>
      <div style={badge("#8b5cf6", "rgba(139,92,246,0.1)", "rgba(139,92,246,0.2)", "")}>
        {displayed.e} Edges
      </div>
    </div>
  );
}
