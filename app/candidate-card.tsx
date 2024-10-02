"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  people,
  company as companyTable,
} from "@/server/db/schemas/users/schema";
import { InferResultType } from "@/utils/infer";
import { InferSelectModel } from "drizzle-orm";
import { Card, Heading, Text, Link, Avatar, Badge } from "frosted-ui";
import { SquareArrowOutUpRight } from "lucide-react";

export default function CandidateCard({
  candidate,
  allMatchingSkills,
  allMatchingJobTitles,
  company,
}: {
  candidate:
    | InferResultType<"people", { company: true }>
    | InferSelectModel<typeof people>;
  allMatchingSkills?: string[];
  allMatchingJobTitles?: string[];
  company?: InferSelectModel<typeof companyTable>;
}) {
  // Select profile picture
  const imageUrl =
    candidate.image ||
    (candidate.twitterData &&
      (candidate.twitterData as any).profile_image_url_https) ||
    (candidate.linkedinData && (candidate.linkedinData as any).photoUrl) ||
    "";

  return (
    <Card className="shadow-md">
      <div className="flex flex-row gap-2 pb-4">
        <div>
          <div className="relative">
            <Avatar
              size={"5"}
              color="blue"
              fallback={(candidate.name || "N").charAt(0).toUpperCase()}
              src={imageUrl}
            />
            {company && (
              <TooltipProvider key={company.id} delayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link target="_blank" href={company.linkedinUrl}>
                      <Avatar
                        className="cursor-pointer shadow-md hover:scale-[101%] active:scale-[99%] transition-all absolute -right-0 -bottom-4"
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
        <div className="flex flex-col w-full">
          <div className="flex flex-row gap-2 items-center justify-between">
            <Heading>{candidate.name}</Heading>
          </div>

          {/* LinkedIn Section */}
          {candidate.linkedinUrl && (
            <div className="mt-2">
              <Heading size="2">LinkedIn</Heading>
              <Link href={candidate.linkedinUrl} target="_blank">
                <SquareArrowOutUpRight className="size-4" />
              </Link>
              <Text>
                {(candidate.linkedinData as any)?.positions
                  ?.positionHistory?.[0]?.companyName || ""}
              </Text>
              <Text>
                {(candidate.linkedinData as any)?.positions
                  ?.positionHistory?.[0]?.title || ""}
              </Text>
            </div>
          )}

          {/* GitHub Section */}
          {candidate.githubLogin && (
            <div className="mt-2">
              <Heading size="2">GitHub</Heading>
              <Link
                href={`https://github.com/${candidate.githubLogin}`}
                target="_blank"
              >
                <SquareArrowOutUpRight className="size-4" />
              </Link>
              <Text>{candidate.githubBio || ""}</Text>
              <Text>{candidate.githubCompany || ""}</Text>
            </div>
          )}

          {/* Twitter Section */}
          {candidate.twitterUsername && (
            <div className="mt-2">
              <Heading size="2">Twitter</Heading>
              <Link
                href={`https://twitter.com/${candidate.twitterUsername}`}
                target="_blank"
              >
                <SquareArrowOutUpRight className="size-4" />
              </Link>
              <Text>{candidate.twitterBio || ""}</Text>
              <Text>
                {candidate.twitterFollowerCount
                  ? `Followers: ${candidate.twitterFollowerCount}`
                  : ""}
              </Text>
            </div>
          )}

          {/* Summary */}
          <Text className="italic text-sm text-primary/60 mt-2">
            {candidate.miniSummary || ""}
          </Text>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 pb-4">
        {/* <Badge */}
        {/*   variant="surface" */}
        {/*   color={candidate.livesNearBrooklyn ? "green" : "red"} */}
        {/* > */}
        {/*   Brooklyn */}
        {/* </Badge> */}
        <Badge
          variant="surface"
          color={candidate.workedInBigTech ? "green" : "red"}
        >
          Big Tech
        </Badge>
        {[
          ...(candidate.topTechnologies ?? []),
          ...(candidate.topFeatures ?? []),
          ...(candidate.uniqueTopics ?? []),
          ...Object.keys(candidate.githubLanguages ?? {}),
        ]?.map((skill) => (
          <>
            {allMatchingSkills?.includes(skill) ? (
              <Badge key={skill} variant="surface" color={"pink"}>
                {skill}
              </Badge>
            ) : null}
          </>
        ))}
        {[...(candidate.jobTitles ?? [])]?.map((jt) => (
          <>
            {allMatchingJobTitles?.includes(jt) ? (
              <Badge key={jt} variant="surface" color={"yellow"}>
                {jt}
              </Badge>
            ) : null}
          </>
        ))}
      </div>
    </Card>
  );
}
