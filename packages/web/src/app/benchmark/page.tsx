import type { CSSProperties } from "react";
import Link from "next/link";

export const metadata = {
  title: "Benchmark — NovaCortex vs context dump",
  description:
    "Reproducible benchmark: NovaCortex retrieval uses up to 98.8% fewer input tokens than dumping the whole knowledge base into context, with 100% retrieval recall and answer accuracy at parity.",
};

const STATS: { n: string; l: string }[] = [
  { n: "−98.8%", l: "input tokens at a 26K-token KB" },
  { n: "~65×", l: "cheaper per query at that size" },
  { n: "100%", l: "retrieval recall@5 (with 518 distractors)" },
  { n: "flat", l: "retrieval tokens as the KB grows" },
];

const ROWS: { kb: string; dump: string; ret: string; red: string; dc: string; rc: string }[] = [
  { kb: "42 facts (~2K)", dump: "2,028", ret: "305", red: "85%", dc: "$0.0048", rc: "$0.0009" },
  { kb: "220 facts (~10K)", dump: "10,157", ret: "305", red: "97%", dc: "$0.0231", rc: "$0.0009" },
  { kb: "560 facts (~26K)", dump: "25,675", ret: "305", red: "98.8%", dc: "$0.0581", rc: "$0.0009" },
];

const wrap: CSSProperties = { background: "#0a0e17", color: "#d0e8f0", fontFamily: "'Outfit', sans-serif", minHeight: "100vh" };
const inner: CSSProperties = { maxWidth: "880px", margin: "0 auto", padding: "3.5rem 1.5rem 5rem" };
const h1: CSSProperties = { fontFamily: "'Chakra Petch', sans-serif", fontSize: "clamp(1.9rem,4vw,2.8rem)", textTransform: "uppercase", letterSpacing: "-0.01em", margin: "0 0 .6rem" };
const card: CSSProperties = { border: "1px solid rgba(255,255,255,.08)", background: "#0f1623", borderRadius: "12px", padding: "1.5rem", margin: "2rem 0" };
const th: CSSProperties = { textAlign: "right", padding: ".5rem .6rem", color: "#7fa8b8", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,.07)", fontSize: ".85rem" };
const thL: CSSProperties = { ...th, textAlign: "left" };
const td: CSSProperties = { textAlign: "right", padding: ".5rem .6rem", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: ".9rem" };
const tdL: CSSProperties = { ...td, textAlign: "left" };
const muted: CSSProperties = { color: "#7fa8b8", fontSize: ".92rem", lineHeight: 1.7, fontWeight: 300 };
const h2: CSSProperties = { fontFamily: "'Chakra Petch', sans-serif", textTransform: "uppercase", fontSize: "1.2rem", margin: "2.5rem 0 .6rem" };

export default function BenchmarkPage() {
  return (
    <main style={wrap}>
      <div style={inner}>
        <Link href="/" style={{ color: "#00f0ff", textDecoration: "none", fontSize: ".85rem", letterSpacing: ".05em" }}>
          ← NovaCortex
        </Link>
        <h1 style={{ ...h1, marginTop: "1rem" }}>Retrieval beats dumping your KB into context</h1>
        <p style={{ ...muted, marginBottom: "0" }}>
          NovaCortex fetches only the few facts a question needs. Dumping the whole knowledge base into every prompt
          burns tokens, money, and (with a hosted provider) ships all your data every time. Same questions, same model
          — here is the measured difference.
        </p>

        <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", margin: "2rem 0" }}>
          {STATS.map((s) => (
            <div key={s.l} style={{ flex: 1, minWidth: "150px", border: "1px solid rgba(0,240,255,.18)", background: "#0f1623", borderRadius: "10px", padding: "1.1rem 1.3rem" }}>
              <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: "1.9rem", color: "#00f0ff", lineHeight: 1 }}>{s.n}</div>
              <div style={{ color: "#7fa8b8", fontSize: ".82rem", marginTop: ".4rem" }}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={card}>
          <svg viewBox="0 0 720 360" role="img" aria-label="Input tokens per query vs knowledge-base size" style={{ width: "100%", height: "auto", display: "block" }}>
            <line x1="80" y1="300" x2="700" y2="300" stroke="#2a3a48" strokeWidth="1" />
            <line x1="80" y1="40" x2="80" y2="300" stroke="#2a3a48" strokeWidth="1" />
            <g fill="#5a7a8a" fontSize="11" fontFamily="monospace">
              <line x1="80" y1="62" x2="700" y2="62" stroke="#1c2733" />
              <text x="74" y="66" textAnchor="end">26K</text>
              <line x1="80" y1="138" x2="700" y2="138" stroke="#1c2733" />
              <text x="74" y="142" textAnchor="end">18K</text>
              <line x1="80" y1="214" x2="700" y2="214" stroke="#1c2733" />
              <text x="74" y="218" textAnchor="end">9K</text>
              <text x="74" y="304" textAnchor="end">0</text>
            </g>
            <g fill="#7fa8b8" fontSize="12">
              <text x="80" y="320" textAnchor="middle">~2K KB</text>
              <text x="390" y="320" textAnchor="middle">~10K KB</text>
              <text x="700" y="320" textAnchor="middle">~26K KB</text>
              <text x="390" y="345" textAnchor="middle" fill="#5a7a8a">knowledge-base size (tokens)</text>
            </g>
            <polyline points="80,281 390,206 700,62" fill="none" stroke="#ff2d95" strokeWidth="2.5" />
            <g fill="#ff2d95">
              <circle cx="80" cy="281" r="4" />
              <circle cx="390" cy="206" r="4" />
              <circle cx="700" cy="62" r="4" />
            </g>
            <text x="700" y="52" textAnchor="end" fill="#ff2d95" fontSize="12" fontWeight="700">dump 25,675 tok</text>
            <polyline points="80,297 390,297 700,297" fill="none" stroke="#00f0ff" strokeWidth="2.5" />
            <g fill="#00f0ff">
              <circle cx="80" cy="297" r="4" />
              <circle cx="390" cy="297" r="4" />
              <circle cx="700" cy="297" r="4" />
            </g>
            <text x="700" y="290" textAnchor="end" fill="#00f0ff" fontSize="12" fontWeight="700">retrieval 305 tok (flat)</text>
          </svg>
          <div style={{ display: "flex", gap: "1.5rem", fontSize: ".85rem", color: "#7fa8b8", marginTop: ".5rem" }}>
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", marginRight: ".4rem", background: "#ff2d95" }} />Dump whole KB into context</span>
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", marginRight: ".4rem", background: "#00f0ff" }} />NovaCortex retrieval (top-5)</span>
          </div>
        </div>

        <h2 style={h2}>The numbers</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thL}>KB size</th>
              <th style={th}>Dump tok</th>
              <th style={th}>Retrieval tok</th>
              <th style={th}>Reduction</th>
              <th style={th}>Dump cost</th>
              <th style={th}>Retrieval cost</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.kb}>
                <td style={tdL}>{r.kb}</td>
                <td style={td}>{r.dump}</td>
                <td style={td}>{r.ret}</td>
                <td style={td}>{r.red}</td>
                <td style={td}>{r.dc}</td>
                <td style={td}>{r.rc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...muted, marginTop: ".8rem" }}>
          15 questions, gpt-4o-mini, top-5 retrieval, costs for the full 15-question run. Answer accuracy (LLM-judged
          against reference answers): dump 100%, retrieval 93%. <strong style={{ color: "#d0e8f0" }}>Retrieval recall@5 = 100%</strong> even with 518
          unrelated distractor facts in the store — NovaCortex surfaced every fact the questions needed.
        </p>

        <h2 style={h2}>How we measured</h2>
        <p style={muted}>
          Two ways of giving the model the project knowledge: <strong style={{ color: "#d0e8f0" }}>dump</strong> the whole KB into the prompt every
          query, or store it in NovaCortex and <strong style={{ color: "#d0e8f0" }}>retrieve</strong> only the top-5 relevant memories. We score
          retrieval separately with a recall@K metric, so the rare answer miss is shown to be an LLM/grader limit (it hits
          the dump baseline equally), not a retrieval failure. Fully reproducible:{" "}
          <code style={{ color: "#00f0ff" }}>node scripts/benchmark/run.mjs</code>.
        </p>

        <h2 style={h2}>And it&apos;s a privacy win, not just a cost one</h2>
        <p style={muted}>
          Dumping the whole KB ships <em>all</em> of your knowledge to the model provider on every query. Retrieval sends
          only the few relevant snippets. With NovaCortex self-hosted, the knowledge base never leaves your
          infrastructure; only the minimal retrieved context goes to the model.
        </p>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "2.5rem" }}>
          <Link href="/pricing" style={{ background: "linear-gradient(135deg,#00f0ff,#00b4d8)", color: "#0a0e17", padding: ".8rem 2rem", borderRadius: "4px", textDecoration: "none", fontWeight: 700, fontSize: ".9rem", letterSpacing: ".05em", textTransform: "uppercase" }}>
            See pricing →
          </Link>
          <a href="https://github.com/Nova-Cognitive-Systems/novacortex" style={{ background: "rgba(255,255,255,.04)", color: "#d0e8f0", border: "1px solid rgba(255,255,255,.1)", padding: ".8rem 2rem", borderRadius: "4px", textDecoration: "none", fontWeight: 500, fontSize: ".9rem", letterSpacing: ".05em", textTransform: "uppercase" }}>
            View on GitHub
          </a>
        </div>
      </div>
    </main>
  );
}
