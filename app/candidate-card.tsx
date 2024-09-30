"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  candidates,
  company as companyTable,
} from "@/server/db/schemas/users/schema";
import { InferResultType } from "@/utils/infer";
import { InferSelectModel } from "drizzle-orm";
import { Card, Heading, Text, Link, Avatar, Badge } from "frosted-ui";
import { SquareArrowOutUpRight } from "lucide-react";

export default function CandidateCard({
  candidate,
  allMatchingSkills,
  company,
}: {
  candidate:
    | InferResultType<"candidates", { company: true }>
    | InferSelectModel<typeof candidates>;
  outbound?: Outbound;
  allMatchingSkills?: string[];
  company?: InferSelectModel<typeof companyTable>;
}) {
  return (
    <Card
      className="shadow-md"
      style={{
        borderColor:
          // candidate.cookdReviewed
          //   ? candidate.cookdData.result === "PASS"
          //     ? "#22c55e"
          //     : "#ef4444"
          //   :
          undefined,
        borderWidth:
          // candidate.cookdReviewed
          //   ? candidate.cookdData.result === "PASS"
          //     ? "1px"
          //     : "1px"
          //   :
          undefined,
        borderStyle:
          // candidate.cookdReviewed
          //   ? candidate.cookdData.result === "PASS"
          //     ? "solid"
          //     : "solid"
          // :
          undefined,
        backgroundColor:
          // candidate.cookdReviewed
          //   ? candidate.cookdData.result === "PASS"
          //     ? "rgba(34, 197, 94, 0.1)"
          //     : "rgba(239, 68, 68, 0.1)"
          //   :
          undefined,
      }}
    >
      <div className="flex flex-row gap-2 pb-4">
        <div>
          <div className="relative">
            <Avatar
              size={"5"}
              color="blue"
              fallback={candidate.linkedinData.firstName
                .toUpperCase()
                .charAt(0)}
              src={candidate.linkedinData.photoUrl ?? ""}
            />
            {company && (
              <TooltipProvider key={company.id} delayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link target="_blank" href={company.linkedinUrl}>
                      <Avatar
                        className="cursor-pointer shadow-md hover:scale-[101%] active:scale-[99%] transition-all absolute -right-0 -bottom-4 "
                        color="blue"
                        size="2"
                        fallback={company.name.charAt(0).toUpperCase()}
                        src={company.logo ?? ""}
                      />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{company.name}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
        <div className="flex flex-col ">
          <div className="flex flex-row gap-2 items-center justify-between">
            <div className="flex flex-row gap-2 items-center">
              <Heading>
                {candidate.linkedinData.firstName +
                  " " +
                  candidate.linkedinData.lastName}
              </Heading>
              <Link
                href={candidate.url!}
                target="_blank"
                className="cursor-pointer"
                key={candidate.id}
              >
                <SquareArrowOutUpRight className="size-4" />
              </Link>
            </div>
            {/* {(candidate.cookdScore ?? 0) > 0 && ( */}
            {/*   <Badge */}
            {/*     color={candidate.cookdData.result === "PASS" ? "green" : "red"} */}
            {/*   > */}
            {/*     {candidate.cookdScore ?? 0} */}
            {/*   </Badge> */}
            {/* )} */}
          </div>
          <div className="flex flex-row gap-1">
            <Text>
              {candidate.linkedinData.positions.positionHistory[0].companyName}{" "}
            </Text>
            <Text>
              {candidate.linkedinData.positions.positionHistory[0].title}
            </Text>
          </div>
          <Text className="italic text-sm text-primary/60">
            {candidate.miniSummary}
          </Text>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pb-4">
        <Badge
          variant="surface"
          color={candidate.livesNearBrooklyn ? "green" : "red"}
        >
          Brooklyn
        </Badge>
        <Badge
          variant="surface"
          color={candidate.workedInBigTech ? "green" : "red"}
        >
          Big Tech
        </Badge>
        {/* <Badge */}
        {/*   variant="surface" */}
        {/*   color={candidate.workedAtRelevant ? "green" : "red"} */}
        {/* > */}
        {/*   {outbound.company} */}
        {/* </Badge> */}
        {candidate.topTechnologies?.map((skill) => (
          <Badge
            key={skill}
            variant="surface"
            color={
              allMatchingSkills && allMatchingSkills.includes(skill)
                ? "pink"
                : "gray"
            }
          >
            {skill}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
