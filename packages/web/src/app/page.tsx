import type { CSSProperties } from "react";
import Link from "next/link";
import { HeroSection } from "@/components/landing/HeroSection";

export const metadata = {
  title: "NovaCortex — Memory for AI Agents",
  description:
    "Graph-native persistent memory for autonomous agents. Semantic + graph retrieval, a portable open format, and an MCP server — self-hosted for free, open source.",
};

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Graph-native memory",
    body: "Typed memories (episodic / semantic / procedural / working) linked by a real relation graph — causes, contradicts, supersedes, same_as and more.",
  },
  {
    title: "Semantic + text retrieval",
    body: "OpenAI-embedding vector search over Qdrant with a transparent text fallback, optional recency weighting, and namespace isolation.",
  },
  {
    title: "Portable & open",
    body: "Export/import the full graph as PMF (JSON, binary MessagePack, or AES-256-GCM encrypted) with Merkle + content-hash integrity. No lock-in.",
  },
  {
    title: "Plugs into your agents",
    body: "REST API, an MCP server (12 tools), TypeScript & Python SDKs, and a CLI — wire memory into Claude, your IDE, or any agent runtime.",
  },
];

const sectionWrap: CSSProperties = {
  background: "#0a0e17",
  color: "#d0e8f0",
  fontFamily: "'Outfit', sans-serif",
  padding: "5rem 1.5rem",
};

export default function LandingPage() {
  return (
    <div style={{ background: "#0a0e17" }}>
      <HeroSection />

      {/* Features */}
      <section style={sectionWrap}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Chakra Petch', sans-serif",
              fontSize: "clamp(1.6rem, 3vw, 2.4rem)",
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
              marginBottom: "2.5rem",
              color: "#d0e8f0",
            }}
          >
            A memory substrate, not a black box
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "1.5rem",
            }}
          >
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{
                  border: "1px solid rgba(0,240,255,0.12)",
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: "8px",
                  padding: "1.5rem",
                }}
              >
                <h3 style={{ color: "#00f0ff", fontSize: "1.05rem", marginBottom: "0.6rem", fontWeight: 600 }}>
                  {f.title}
                </h3>
                <p style={{ color: "#7fa8b8", fontSize: "0.92rem", lineHeight: 1.6, fontWeight: 300 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Self-host + pricing teaser */}
      <section id="selfhost" style={{ ...sectionWrap, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "'Chakra Petch', sans-serif",
              fontSize: "clamp(1.6rem, 3vw, 2.4rem)",
              textTransform: "uppercase",
              marginBottom: "1rem",
              color: "#d0e8f0",
            }}
          >
            Self-host in minutes — free
          </h2>
          <p style={{ color: "#7fa8b8", marginBottom: "1.5rem", lineHeight: 1.7, fontWeight: 300 }}>
            One <code style={{ color: "#00f0ff" }}>docker compose up</code> brings up the API, web UI, SurrealDB and
            Qdrant. Open source under Apache-2.0. Upgrade to Pro for federation and higher limits when you need them.
            {" "}<Link href="/benchmark" style={{ color: "#00f0ff", textDecoration: "none" }}>See the benchmark →</Link>
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/pricing"
              style={{
                background: "linear-gradient(135deg, #00f0ff, #00b4d8)",
                color: "#0a0e17",
                padding: "0.8rem 2rem",
                borderRadius: "4px",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "0.9rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              See pricing →
            </Link>
            <a
              href="https://github.com/Nova-Cognitive-Systems/novacortex"
              target="_blank"
              rel="noreferrer"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "#d0e8f0",
                border: "1px solid rgba(255,255,255,0.1)",
                padding: "0.8rem 2rem",
                borderRadius: "4px",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.9rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: "#070a11",
          color: "#4a7a8a",
          padding: "2rem 1.5rem",
          textAlign: "center",
          fontFamily: "'Outfit', sans-serif",
          fontSize: "0.85rem",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <Link href="/benchmark" style={{ color: "#7fa8b8", textDecoration: "none" }}>Benchmark</Link>
          <Link href="/pricing" style={{ color: "#7fa8b8", textDecoration: "none" }}>Pricing</Link>
          <Link href="/login" style={{ color: "#7fa8b8", textDecoration: "none" }}>Sign in</Link>
          <a href="https://github.com/Nova-Cognitive-Systems/novacortex" style={{ color: "#7fa8b8", textDecoration: "none" }}>GitHub</a>
        </div>
        <div>NovaCortex · Apache-2.0 · open-core memory for AI agents</div>
      </footer>
    </div>
  );
}
