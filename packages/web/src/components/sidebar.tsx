"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  Network,
  Settings,
  Brain,
  Sun,
  Moon,
  Menu,
  X,
  BookOpen,
  FolderTree,
  KeyRound,
  Cpu,
  LogOut,
} from "lucide-react";
import { clearAuthToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useTheme, designs, type Design } from "@/components/theme-provider";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/memories", label: "Memories", icon: Database },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/graph", label: "Graph View", icon: Network },
  { href: "/namespaces", label: "Namespaces", icon: FolderTree },
  { href: "/agents", label: "Agents & Keys", icon: KeyRound },
  { href: "/processor", label: "Processor", icon: Cpu },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { design, setDesign } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  const currentDesign = designs.find((d) => d.id === design);
  const otherDesign = designs.find((d) => d.id !== design);

  const toggleDesign = () => {
    setDesign(otherDesign?.id as Design);
  };

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 bg-card border-b">
        <div className="flex items-center gap-2">
          <Brain className="h-6 w-6 text-[#ff5600]" />
          <h1 className="text-lg font-normal">NovaCortex</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed lg:relative z-50 lg:z-auto",
          "flex h-full w-64 flex-col border-r bg-card border-[#dedbd6]",
          "transition-transform duration-300 ease-in-out",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-3 p-6">
          <Brain className="h-8 w-8 text-[#ff5600]" />
          <div>
            <h1 className="text-xl font-normal tracking-tight">NovaCortex</h1>
            <p className="text-xs text-muted-foreground">AI Memory System</p>
          </div>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              mounted && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} onClick={closeSidebar}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start relative",
                    isActive
                      ? "bg-[#111111] text-white hover:bg-[#111111] hover:text-white border-l-2 border-[#ff5600] rounded-l-none pl-[14px]"
                      : "text-[#7b7b78] hover:text-[#111111] hover:bg-secondary"
                  )}
                >
                  <item.icon className={cn("mr-2 h-4 w-4", isActive && "text-[#ff5600]")} />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
        <Separator />

        {/* Help & Theme */}
        <div className="p-4 space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start text-[#7b7b78] hover:text-[#111111] hover:bg-secondary"
            onClick={() => {
              clearAuthToken();
              window.location.href = "/login";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span className="flex-1 text-left">Logout</span>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-[#7b7b78] hover:text-[#111111] hover:bg-secondary"
            onClick={toggleDesign}
          >
            {design === "dark" ? (
              <Moon className="mr-2 h-4 w-4" />
            ) : (
              <Sun className="mr-2 h-4 w-4" />
            )}
            <span className="flex-1 text-left">{currentDesign?.name}</span>
          </Button>
        </div>
      </div>
    </>
  );
}
