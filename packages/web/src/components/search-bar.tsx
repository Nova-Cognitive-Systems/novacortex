"use client";

import { useState, useCallback } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onSearch?: (value: string) => void;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search memories...",
  className,
  onSearch,
}: SearchBarProps) {
  const [focused, setFocused] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && onSearch) {
        onSearch(value);
      }
    },
    [onSearch, value]
  );

  const handleClear = useCallback(() => {
    onChange("");
    if (onSearch) onSearch("");
  }, [onChange, onSearch]);

  return (
    <div className={cn("relative", className)} data-hint="search-bar">
      <Search
        className={cn(
          "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors",
          focused ? "text-[#ff5600]" : "text-muted-foreground"
        )}
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className="pl-10 pr-10"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
          onClick={handleClear}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
