"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const HeroCanvases = dynamic(
  () => import("./HeroCanvases").then((m) => m.HeroCanvases),
  { ssr: false }
);

export function HeroSection() {

  return (
    <section
      style={{
        position: "relative",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        animation: "nc-flicker 8s step-end infinite",
      }}
    >
      {/* Layer 1: Tron grid + Layer 2: Knowledge graph */}
      <HeroCanvases />

      {/* Layer 3: Radial overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          background:
            "radial-gradient(ellipse 70% 70% at center, rgba(10,14,23,0.05) 0%, rgba(10,14,23,0.35) 35%, rgba(10,14,23,0.88) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Hero content */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          textAlign: "center",
          maxWidth: "800px",
          padding: "0 1.5rem",
          animation: "nc-horzGlitch 12s step-end infinite",
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            border: "1px solid rgba(0,240,255,0.08)",
            background: "rgba(10,14,23,0.7)",
            padding: "0.35rem 1rem",
            borderRadius: "99px",
            fontSize: "0.75rem",
            color: "#00f0ff",
            fontWeight: 500,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: "1.5rem",
            backdropFilter: "blur(10px)",
            opacity: 0,
            animation: "nc-fadeUp 0.8s ease forwards 0.3s",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              background: "#00f0ff",
              borderRadius: "50%",
              boxShadow: "0 0 8px #00f0ff",
              animation: "nc-blink 2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          Open Source · Self-Hostable
        </div>

        {/* H1 */}
        <h1
          style={{
            fontFamily: "'Chakra Petch', sans-serif",
            fontWeight: 700,
            fontSize: "clamp(2.5rem, 5.5vw, 5rem)",
            textTransform: "uppercase",
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            marginBottom: "1.2rem",
            color: "#d0e8f0",
            textShadow: "0 2px 40px rgba(0,0,0,0.6)",
            opacity: 0,
            animation: "nc-fadeUp 1s ease forwards 0.5s",
          }}
        >
          Memory for
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #00f0ff, #ff2d95)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: "drop-shadow(0 0 20px rgba(0,240,255,0.3))",
            }}
          >
            AI Agents
          </span>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 300,
            fontSize: "1.1rem",
            color: "#4a7a8a",
            maxWidth: "520px",
            margin: "0 auto 2.5rem",
            lineHeight: 1.7,
            opacity: 0,
            animation: "nc-fadeUp 1s ease forwards 0.7s",
          }}
        >
          Graph-native persistent memory for autonomous agents. 90%+ token
          savings, sub-millisecond retrieval, and a portable open standard —
          self-hosted for free.
        </p>

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            justifyContent: "center",
            flexWrap: "wrap",
            opacity: 0,
            animation: "nc-fadeUp 1s ease forwards 0.9s",
            pointerEvents: "all",
          }}
        >
          <Link
            href="/dashboard"
            style={{
              background: "linear-gradient(135deg, #00f0ff, #00b4d8)",
              color: "#0a0e17",
              padding: "0.8rem 2rem",
              borderRadius: "4px",
              textDecoration: "none",
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 700,
              fontSize: "0.9rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              boxShadow: "0 0 30px rgba(0,240,255,0.2)",
            }}
          >
            Open Dashboard →
          </Link>
          <a
            href="#selfhost"
            style={{
              background: "rgba(10,14,23,0.6)",
              color: "#d0e8f0",
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "0.8rem 2rem",
              borderRadius: "4px",
              textDecoration: "none",
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 500,
              fontSize: "0.9rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              backdropFilter: "blur(8px)",
            }}
          >
            Self-Host Free ↓
          </a>
        </div>
      </div>
    </section>
  );
}
