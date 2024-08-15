"use client";

import { api } from "@/trpc/react";
import {
  Card,
  Flex,
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
import CandidateCard from "./candidate-card";

export default function RecommendedOutboundResults() {
  const recommendedResults =
    api.outbound.searches.useQuery({ recommended: true }).data ?? [];

  return (
    <div>
      {recommendedResults.map((prev, index) => (
        <Card key={index} className="max-w-[95%] w-[300px]">
          <div className="flex flex-col gap-4">
            <Text className="max-w-[300px]" size="4" weight="bold">
              {prev.query}
            </Text>
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="surface" color="gray">
                {prev.job}
              </Badge>
              {prev.company !== "" && (
                <Badge variant="surface" color="gray">
                  {prev.company}
                </Badge>
              )}
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
                <Button style={{ cursor: "pointer" }}>View Candidates</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Candidates</DialogTitle>
                <DialogDescription className="font-bold text-2xl italic">
                  List of candidates sorted by weight.
                </DialogDescription>
                <ScrollArea className="py-4">
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
  );
}
