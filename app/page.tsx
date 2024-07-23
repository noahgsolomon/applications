import { api } from "@/trpc/server";
import { Button, Container, Flex, Heading, Link } from "frosted-ui";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await api.user.me();
  if (!user.isLoggedIn) redirect("/login");

  return (
    <div>
      <Container className="pt-36">
        <Flex
          className="w-full"
          align={"center"}
          direction={"column"}
          gap={"4"}
        >
          <Heading>Sup {user.user.name}.</Heading>
        </Flex>
      </Container>
    </div>
  );
}
