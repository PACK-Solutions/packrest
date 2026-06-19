"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

// Simple two-state cycle: click to flip between light and dark. We resolve
// `system` against the OS preference at click time so the first click always
// goes somewhere visibly different from the current rendering.
export default function ThemeToggle({
  variant = "menu",
}: {
  // Kept for API compatibility — both values now render the same square
  // icon button, since the sidebar no longer hosts a row variant.
  variant?: "menu" | "icon";
}) {
  void variant;
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const handleClick = () => setTheme(isDark ? "light" : "dark");

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Passer en thème clair" : "Passer en thème sombre"}
      onClick={handleClick}
      suppressHydrationWarning
    >
      {isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
