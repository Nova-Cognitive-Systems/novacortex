"use client";

import * as React from "react";

export type Design = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultDesign?: Design;
  storageKey?: string;
};

type ThemeProviderState = {
  design: Design;
  setDesign: (design: Design) => void;
};

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined);

export const designs: { id: Design; name: string; description: string }[] = [
  { id: "dark", name: "Dark", description: "Sleek dark mode with violet accents" },
  { id: "light", name: "Light", description: "Clean light mode for daytime" },
];

export function ThemeProvider({
  children,
  defaultDesign = "light",
  storageKey = "novacortex-theme",
  ...props
}: ThemeProviderProps) {
  const [design, setDesign] = React.useState<Design>(defaultDesign);

  React.useEffect(() => {
    const storedDesign = localStorage.getItem(`${storageKey}-design`) as Design | null;
    if (storedDesign && (storedDesign === "dark" || storedDesign === "light")) {
      setDesign(storedDesign);
    }
  }, [storageKey]);

  React.useEffect(() => {
    const root = window.document.documentElement;

    // Remove all design classes
    root.classList.remove("dark", "light");

    // Add current design class
    root.classList.add(design);
  }, [design]);

  const value = {
    design,
    setDesign: (newDesign: Design) => {
      localStorage.setItem(`${storageKey}-design`, newDesign);
      setDesign(newDesign);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
