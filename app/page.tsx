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
  Avatar,
} from "frosted-ui";
import { redirect } from "next/navigation";
import OutboundDialog from "./outbound-dialog";
import { candidates } from "@/server/db/schemas/users/schema";
import { outbound } from "@/src/helper";
import { Check, X } from "lucide-react";

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
                            <Card>
                              <Heading className="underline">Matches:</Heading>
                              <Flex className="py-2" direction="column" gap="2">
                                {prev.matches
                                  .sort((a, b) => b.weight! - a.weight!)
                                  .map((candidate) => (
                                    <Card key={candidate.id}>
                                      <div className="flex flex-row  gap-2 pb-4">
                                        <Avatar
                                          size={"5"}
                                          color="blue"
                                          fallback={candidate.linkedinData.firstName
                                            .toUpperCase()
                                            .charAt(0)}
                                          src={
                                            candidate.linkedinData.photoUrl ??
                                            ""
                                          }
                                        />
                                        <div className="flex flex-col ">
                                          <Heading>
                                            {candidate.linkedinData.firstName +
                                              " " +
                                              candidate.linkedinData.lastName}
                                          </Heading>
                                          <div className="flex flex-row gap-1">
                                            <Text>
                                              {
                                                candidate.linkedinData.positions
                                                  .positionHistory[0]
                                                  .companyName
                                              }
                                            </Text>

                                            <Text>
                                              {
                                                candidate.linkedinData.positions
                                                  .positionHistory[0].title
                                              }
                                            </Text>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex flex-col gap-2 pb-4">
                                        <Text
                                          size={"2"}
                                          className="italic flex flex-row gap-1 items-center"
                                        >
                                          Lives near Brooklyn:{" "}
                                          {candidate.livesNearBrooklyn ? (
                                            <Check color="#00ff00" />
                                          ) : (
                                            <X color="#ff0000" />
                                          )}
                                        </Text>
                                        <Text
                                          size={"2"}
                                          className="italic flex flex-row gap-1 items-center"
                                        >
                                          Has worked in Big Tech:{" "}
                                          {candidate.livesNearBrooklyn ? (
                                            <Check color="#00ff00" />
                                          ) : (
                                            <X color="#ff0000" />
                                          )}
                                        </Text>
                                        <Text
                                          size={"2"}
                                          className="italic flex flex-row gap-1 items-center"
                                        >
                                          Worked at {prev.company}:{" "}
                                          {candidate.workedAtRelevant ? (
                                            <Check color="#00ff00" />
                                          ) : (
                                            <X color="#ff0000" />
                                          )}
                                        </Text>
                                      </div>
                                      <Link
                                        href={candidate.url!}
                                        target="_blank"
                                        key={candidate.id}
                                      >
                                        {candidate.url}
                                      </Link>
                                    </Card>
                                  ))}
                              </Flex>
                            </Card>
                            <Flex
                              className="py-4 pt-8"
                              direction="column"
                              gap="2"
                            >
                              <div>
                                <Heading>Remaining</Heading>
                                <Text className="italic text-sm opacity-80">
                                  in sorted order
                                </Text>
                              </div>
                              {prev.candidates
                                .filter(
                                  (candidate) =>
                                    !prev.matches
                                      .map((match) => match.id)
                                      .includes(candidate.id),
                                )
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
