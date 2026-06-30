import Link from "next/link";

export const metadata = {
  title: "Pricing — NovaCortex",
  description:
    "NovaCortex is open source and free to self-host. Upgrade to Pro for federation and higher limits, or Enterprise for unlimited scale and support.",
};

const REPO = "https://github.com/Nova-Cognitive-Systems/novacortex";

type Tier = {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "self-hosted",
    tagline: "Everything you need to run NovaCortex yourself.",
    features: [
      "3 namespaces",
      "Semantic + graph retrieval",
      "MCP server, REST API, SDKs & CLI",
      "PMF export/import (JSON, binary, encrypted)",
      "Community support (GitHub)",
    ],
    cta: { label: "Self-host free", href: REPO },
  },
  {
    name: "Pro",
    price: "$10",
    cadence: "one-time unlock",
    tagline: "For teams that need cross-namespace memory and more room.",
    features: [
      "10 namespaces",
      "Namespace federation (cross-namespace reads)",
      "Higher API rate limits",
      "Priority email support",
      "Everything in Free",
    ],
    cta: { label: "Get Pro (early access)", href: `${REPO}/discussions` },
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "contact us",
    tagline: "Unlimited scale, SSO/onboarding and an SLA.",
    features: [
      "Unlimited namespaces",
      "Highest rate limits",
      "Priority support with SLA",
      "Deployment & migration help",
      "Everything in Pro",
    ],
    cta: { label: "Contact us", href: `${REPO}/discussions` },
  },
];

export default function PricingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0e17",
        color: "#d0e8f0",
        fontFamily: "'Outfit', sans-serif",
        padding: "4rem 1.5rem",
      }}
    >
      <div style={{ maxWidth: "1040px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <Link href="/" style={{ color: "#00f0ff", textDecoration: "none", fontSize: "0.85rem", letterSpacing: "0.05em" }}>
            ← NovaCortex
          </Link>
          <h1
            style={{
              fontFamily: "'Chakra Petch', sans-serif",
              fontSize: "clamp(2rem, 4vw, 3rem)",
              textTransform: "uppercase",
              margin: "1rem 0 0.75rem",
            }}
          >
            Open core. Free to self-host.
          </h1>
          <p style={{ color: "#7fa8b8", fontWeight: 300 }}>
            The whole engine is Apache-2.0 and free to run yourself. Paid tiers unlock federation, higher limits and support.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1.5rem",
            alignItems: "stretch",
          }}
        >
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              style={{
                display: "flex",
                flexDirection: "column",
                border: tier.highlight ? "1px solid rgba(0,240,255,0.5)" : "1px solid rgba(255,255,255,0.1)",
                background: tier.highlight ? "rgba(0,240,255,0.04)" : "rgba(255,255,255,0.02)",
                borderRadius: "10px",
                padding: "2rem",
                boxShadow: tier.highlight ? "0 0 40px rgba(0,240,255,0.12)" : "none",
              }}
            >
              <h2 style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: "1.3rem", textTransform: "uppercase", color: "#00f0ff" }}>
                {tier.name}
              </h2>
              <div style={{ margin: "0.75rem 0 0.25rem", display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                <span style={{ fontSize: "2.2rem", fontWeight: 700 }}>{tier.price}</span>
                <span style={{ color: "#4a7a8a", fontSize: "0.85rem" }}>{tier.cadence}</span>
              </div>
              <p style={{ color: "#7fa8b8", fontSize: "0.9rem", fontWeight: 300, margin: "0.5rem 0 1.5rem", lineHeight: 1.6 }}>
                {tier.tagline}
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem", flexGrow: 1 }}>
                {tier.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: "0.5rem", padding: "0.35rem 0", color: "#c0d8e0", fontSize: "0.9rem" }}>
                    <span style={{ color: "#00f0ff" }}>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={tier.cta.href}
                target="_blank"
                rel="noreferrer"
                style={{
                  textAlign: "center",
                  background: tier.highlight ? "linear-gradient(135deg, #00f0ff, #00b4d8)" : "rgba(255,255,255,0.05)",
                  color: tier.highlight ? "#0a0e17" : "#d0e8f0",
                  border: tier.highlight ? "none" : "1px solid rgba(255,255,255,0.15)",
                  padding: "0.75rem 1rem",
                  borderRadius: "4px",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {tier.cta.label}
              </a>
            </div>
          ))}
        </div>

        <p style={{ textAlign: "center", color: "#4a7a8a", fontSize: "0.85rem", marginTop: "2.5rem", fontWeight: 300 }}>
          Pro is a one-time license key (ed25519-signed, offline-validated). Checkout is rolling out — request early
          access via GitHub Discussions.
        </p>
      </div>
    </main>
  );
}
