import { Box, Container, Separator, Button } from "frosted-ui";
import WhopLogo from "./WhopLogo";
import Link from "next/link";
import { api } from "@/trpc/server";
// import { signOut } from "next-auth/react";
import ThemeButton from "./theme-button";
import LogoutButton from "./logout-button";

export default async function Header() {
  const user = await api.user.me();

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
              <ThemeButton />

              {!user?.isLoggedIn ? (
                <>
                  <Link href="/login">
                    <Button
                      className="hover:cursor-pointer"
                      variant="classic"
                      color="orange"
                    >
                      Log in
                    </Button>
                  </Link>
                </>
              ) : (
                <LogoutButton />
              )}
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
