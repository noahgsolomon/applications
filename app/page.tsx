import { api } from "@/trpc/server";
import { Container, Flex, Heading } from "frosted-ui";
import { redirect } from "next/navigation";
import OutboundDialog from "./outbound-dialog";

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
          <Heading className="pb-12">Welcome in</Heading>
          <OutboundDialog />
        </Flex>
      </Container>
    </div>
  );
}
