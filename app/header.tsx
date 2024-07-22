// app/header.tsx
"use client";

import { Box, Container, Separator, Button } from "frosted-ui";
import WhopLogo from "./WhopLogo";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon12, Sun12 } from "@frosted-ui/icons";

export default function Header() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  return (
    <header className="sticky top-0 backdrop-blur-lg z-10 backdrop-saturate-150">
      <div className="absolute inset-0 bg-panel-translucent -z-[1]" />
      <Container size="4">
        <Box>
          <div className="mx-4 py-4 flex items-center justify-between">
            <Link href="/">
              <WhopLogo className="w-[137px] h-auto" />
            </Link>
            <div className="flex items-center gap-4">
              <Button
                style={{ cursor: "pointer" }}
                onClick={toggleTheme}
                variant="surface"
              >
                {theme === "light" ? (
                  <Moon12 className="size-3 text-[#6c7278]" />
                ) : (
                  <Sun12 className="size-3 stroke-surface  fill-white" />
                )}
              </Button>
              <Link href="/login">
                <Button className="hover:cursor-pointer" variant="surface">
                  Log in
                </Button>
              </Link>
              <Link href="/signup">
                <Button
                  className="hover:cursor-pointer"
                  variant="classic"
                  color="orange"
                >
                  Sign up
                </Button>
              </Link>
            </div>
          </div>
        </Box>
      </Container>
      <Separator
        color="gray"
        orientation="horizontal"
        size="4"
        className="relative z-[1]"
      />
    </header>
  );
}
