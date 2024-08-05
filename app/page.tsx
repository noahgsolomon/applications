import { api } from "@/trpc/server";
import { Container, Flex, Heading } from "frosted-ui";
import { redirect } from "next/navigation";
import OutboundDialog from "./outbound-dialog";
import PreviousOutboundSearches from "./previous-outbound-searches";

export default async function Home() {
  const user = await api.user.me();
  if (!user.isLoggedIn) redirect("/login");
  const previousOutboundSearches = await api.outbound.searches();

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
          <PreviousOutboundSearches
            previousOutboundSearches={previousOutboundSearches}
          />
        </Flex>
      </Container>
    </div>
  );
}
