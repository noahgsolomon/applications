"use client";
import { Moon12, Sun12 } from "@frosted-ui/icons";
import { Button } from "frosted-ui";
import { useTheme } from "next-themes";

export default function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };
  return (
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
  );
}
