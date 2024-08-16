"use client";

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
  outbound,
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
    <Card>
      <div className="flex flex-row  gap-2 pb-4">
        <div>
          <div className="relative">
            {" "}
            <Avatar
              size={"5"}
              color="blue"
              fallback={candidate.linkedinData.firstName
                .toUpperCase()
                .charAt(0)}
              src={candidate.linkedinData.photoUrl ?? ""}
            />
            {company && (
              <Avatar
                size={"2"}
                className="absolute -bottom-3 -right-1"
                color="blue"
                fallback={company?.name.toUpperCase().charAt(0) ?? ""}
                src={company?.logo ?? ""}
              />
            )}
          </div>
        </div>
        <div className="flex flex-col ">
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
          <div className="flex flex-row gap-1">
            {/* <Text> */}
            {/*   {candidate.linkedinData.positions.positionHistory[0].companyName} */}
            {/* </Text> */}

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
