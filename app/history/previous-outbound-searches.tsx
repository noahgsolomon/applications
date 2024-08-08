"use client";

import { api } from "@/trpc/react";
import { type api as ServerApi } from "@/trpc/server";
import {
  Card,
  Flex,
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
  Badge,
} from "frosted-ui";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import CandidateCard from "../candidate-card";

export default function PreviousOutboundSearches({
  previousOutboundSearches,
}: {
  previousOutboundSearches: Awaited<
    ReturnType<typeof ServerApi.outbound.searches>
  >;
}) {
  const [searches, setSearches] = useState(previousOutboundSearches);

  const outboundSearchesQuery = api.outbound.searches.useQuery(undefined, {
    enabled: false,
    initialData: previousOutboundSearches,
  });

  useEffect(() => {
    if (outboundSearchesQuery.isFetched && outboundSearchesQuery.data) {
      setSearches(outboundSearchesQuery.data);
    }
  }, [outboundSearchesQuery.isFetched, outboundSearchesQuery.data]);

  return (
    <>
      {searches.length > 0 && (
        <div>
          <div className="flex flex-col sm:flex-row flex-wrap max-w-[800px] gap-4 items-center justify-center mx-auto">
            {searches.map((prev, index) => (
              <Card key={index} className="max-w-[95%] w-[300px]">
                <div className="flex flex-col gap-4">
                  <Text className="max-w-[300px]" size="4" weight="bold">
                    {prev.query}
                  </Text>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge variant="surface" color="gray">
                      {prev.job}
                    </Badge>

                    <Badge variant="surface" color="gray">
                      {prev.company}
                    </Badge>
                    <Badge variant="surface" className="flex flex-row gap-1">
                      Near Brooklyn:{" "}
                      {prev.nearBrooklyn ? (
                        <Check className="text-green-500/60 size-4" />
                      ) : (
                        <X className="text-red-500/60 size-4" />
                      )}
                    </Badge>
                  </div>

                  <DialogRoot>
                    <DialogTrigger>
                      <Button style={{ cursor: "pointer" }}>
                        View Candidates
                      </Button>
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
                            {prev.matches.length === 0
                              ? "No matches 😲"
                              : prev.matches
                                  .sort((a, b) => b.weight! - a.weight!)
                                  .map((candidate) => (
                                    <CandidateCard
                                      key={candidate.id}
                                      candidate={candidate}
                                      outbound={prev}
                                    />
                                  ))}
                          </Flex>
                        </Card>
                        <Flex className="py-4 pt-8" direction="column" gap="2">
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
                              <CandidateCard
                                key={candidate.id}
                                candidate={candidate}
                                outbound={prev}
                              />
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
          </div>
        </div>
      )}
    </>
  );
}
