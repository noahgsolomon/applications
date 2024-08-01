import { api } from "@/trpc/server";
import {
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Text,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogRoot,
  ScrollArea,
  Button,
  Link,
} from "frosted-ui";
import { redirect } from "next/navigation";
import OutboundDialog from "./outbound-dialog";

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
          {previousOutboundSearches.length > 0 && (
            <div className="pt-12">
              <Heading className="pb-6 w-full text-center">
                Previous Outbound Searches
              </Heading>
              <Flex wrap={"wrap"} gap={"4"}>
                {previousOutboundSearches.map((prev, index) => (
                  <Card key={index} size={"4"}>
                    <div className="flex flex-col gap-2">
                      <Text size="4" weight="bold">
                        {prev.query}
                      </Text>
                      <Text size="4">{prev.job}</Text>
                      <Text size="4">
                        Near Brooklyn: {prev.near_brooklyn ? "Yes" : "No"}
                      </Text>

                      <DialogRoot>
                        <DialogTrigger>
                          <Text
                            size="3"
                            color="purple"
                            className="underline cursor-pointer"
                          >
                            View Candidates
                          </Text>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogTitle>Candidates</DialogTitle>
                          <DialogDescription className="font-bold text-2xl italic">
                            List of candidates sorted by weight.
                          </DialogDescription>
                          <ScrollArea>
                            <Flex className="py-2" direction="column" gap="2">
                              {prev.candidates
                                .sort((a, b) => b.weight! - a.weight!)
                                .map((candidate) => (
                                  <Link
                                    href={candidate.url!}
                                    target="_blank"
                                    key={candidate.id}
                                  >
                                    {candidate.url}
                                  </Link>
                                ))}
                            </Flex>
                          </ScrollArea>
                          <DialogClose>
                            <Button variant="classic">Close</Button>
                          </DialogClose>
                        </DialogContent>
                      </DialogRoot>
                    </div>
                  </Card>
                ))}
              </Flex>
            </div>
          )}
        </Flex>
      </Container>
    </div>
  );
}
