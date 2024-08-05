// components/ThemeProvider.tsx
"use client";

import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { Theme } from "frosted-ui";
import { ReactNode, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";

interface ThemeProviderProps {
  children: ReactNode;
}

function ThemeWrapper({ children }: { children: ReactNode }) {
  const { theme, resolvedTheme } = useTheme();
  const appearance = (resolvedTheme || theme) as "light" | "dark";

  return (
    <Theme
      appearance={appearance}
      grayColor="slate"
      accentColor="iris"
      infoColor="sky"
      successColor="green"
      warningColor="yellow"
      dangerColor="red"
    >
      {children}

      <Toaster richColors />
    </Theme>
  );
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure we're rendering client-side to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <NextThemeProvider attribute="class">
      <ThemeWrapper>{children}</ThemeWrapper>
    </NextThemeProvider>
  );
}
