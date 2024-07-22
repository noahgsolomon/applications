import { api } from "@/trpc/server";
import { Button, Container, Flex, Heading, Link } from "frosted-ui";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await api.auth.getSession();
  if (!session) redirect("/login");

  return (
    <div>
      <Container m="8">
        <Flex
          className="w-full"
          align={"center"}
          direction={"column"}
          gap={"4"}
        ></Flex>
      </Container>
    </div>
  );
}
