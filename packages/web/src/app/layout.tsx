import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500"],
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "NovaCortex — The Memory OS for AI Agents",
  description:
    "Graph-native, self-hosted AI memory layer. 90%+ token savings, PMF portable memory format, MCP built-in. Free and open source.",
  keywords: [
    "AI memory", "agent memory", "self-hosted AI", "MCP memory",
    "knowledge graph", "RAG memory layer", "mem0 alternative",
    "cognee alternative", "PMF portable memory",
  ],
  openGraph: {
    title: "NovaCortex — The Memory OS for AI Agents",
    description: "Graph-native persistent memory for Claude, GPT, and any MCP client. Self-hostable, free, open source.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${dmSans.variable} ${dmMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
