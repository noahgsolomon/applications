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
import { InferSelectModel } from "drizzle-orm";
import {
  Card,
  Heading,
  Text,
  Link,
  Avatar,
  Badge,
  Flex,
  Separator,
  Progress,
} from "frosted-ui";
import { Linkedin, Github, Twitter, Building } from "lucide-react";

export default function CandidateCard({
  candidate,
  bigTech,
  activeGithub,
  whopUser,
  company,
}: {
  candidate: {
    data: InferSelectModel<typeof people>;
    score: number;
    matchedSkills?: { score: number; skill: string }[];
    matchedJobTitle?: { score: number; jobTitle: string };
    matchedLocation?: { score: number; location: string };
  };
  bigTech: boolean;
  activeGithub: boolean;
  whopUser: boolean;
  company?: InferSelectModel<typeof companyTable>;
}) {
  const { data, score, matchedLocation, matchedSkills, matchedJobTitle } =
    candidate;
  const imageUrl =
    data.image ||
    (data.twitterData && (data.twitterData as any).profile_image_url_https) ||
    (data.linkedinData && (data.linkedinData as any).photoUrl) ||
    "";

  return (
    <Card className="shadow-md p-6">
      <Flex direction="row" gap="4" align="start">
        <div className="relative">
          <Avatar
            size="7"
            color="blue"
            fallback={(data.name || "N").charAt(0).toUpperCase()}
            src={imageUrl}
          />
          {company && (
            <TooltipProvider key={company.id} delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link target="_blank" href={company.linkedinUrl}>
                    <Avatar
                      className="cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all absolute -right-2 -bottom-2"
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
        <Flex direction="column" gap="2" className="flex-grow">
          <Flex justify="between" align="center">
            <Flex gap="2">
              {data.linkedinUrl && (
                <Link href={data.linkedinUrl} target="_blank">
                  <Linkedin className="size-5 text-blue-600 " />
                </Link>
              )}
              {data.githubLogin && (
                <Link
                  href={`https://github.com/${data.githubLogin}`}
                  target="_blank"
                >
                  <Github className="size-5 text-gray-700 " />
                </Link>
              )}
              {data.twitterUsername && (
                <Link
                  href={`https://twitter.com/${data.twitterUsername}`}
                  target="_blank"
                >
                  <Twitter className="size-5 text-sky-500 " />
                </Link>
              )}
            </Flex>
          </Flex>
          <Text className="text-primary/80">
            {(data.linkedinData as any)?.positions?.positionHistory?.[0]
              ?.title || ""}
          </Text>
          {(data.linkedinData as any)?.positions?.positionHistory?.[0]
            ?.companyName && (
            <Flex align="center" gap="2" className="text-primary/60">
              <Building className="size-4" />
              <Text>
                {(data.linkedinData as any)?.positions?.positionHistory?.[0]
                  ?.companyName || ""}
              </Text>
            </Flex>
          )}
          {data.miniSummary && (
            <Text className="italic text-sm text-primary/60 mt-2">
              {data.miniSummary}
            </Text>
          )}
        </Flex>
      </Flex>

      <Separator className="my-4" />

      <Flex direction="column" gap="4">
        {data.githubBio && (
          <Flex
            className="italic text-sm text-primary/60"
            direction="column"
            gap="1"
          >
            <Heading size="2">GitHub Bio</Heading>
            <Text>{data.githubBio}</Text>
          </Flex>
        )}

        {data.twitterBio && (
          <Flex
            className="italic text-sm text-primary/60"
            direction="column"
            gap="1"
          >
            <Heading size="2">Twitter Bio</Heading>
            <Text>{data.twitterBio}</Text>
            {data.twitterFollowerCount && (
              <Text size="1" className="text-primary/60">
                Followers: {data.twitterFollowerCount.toLocaleString()}
              </Text>
            )}
          </Flex>
        )}
        <Flex wrap="wrap" gap="2">
          <Badge
            variant="surface"
            color={score >= 0.75 ? "green" : score >= 0.5 ? "yellow" : "red"}
          >
            {score}
          </Badge>
          {bigTech && (
            <Badge
              variant="surface"
              color={data.workedInBigTech ? "green" : "red"}
            >
              {data.workedInBigTech ? "Big Tech" : "Non-Big Tech"}
            </Badge>
          )}
          {matchedSkills &&
            matchedSkills.length > 0.75 &&
            matchedSkills
              .filter((skill) => skill.score > 0)
              .map((skill) => (
                <TooltipProvider key={skill.skill}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="surface" color="pink">
                        {skill.skill}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{skill.score}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
          {matchedJobTitle && matchedJobTitle.score > 0.75 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="surface" color="yellow">
                    {matchedJobTitle.jobTitle}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{matchedJobTitle.score}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {matchedLocation && matchedLocation.score > 0.75 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="surface" color="green">
                    {matchedLocation.location}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{matchedLocation.score}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
