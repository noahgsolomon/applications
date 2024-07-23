"use client";

import { Button } from "frosted-ui";
import { signOut } from "next-auth/react";

export default function LogoutButton() {
  return (
    <Button
      onClick={() => signOut()}
      className="hover:cursor-pointer"
      variant="classic"
      color="orange"
    >
      Log out
    </Button>
  );
}
