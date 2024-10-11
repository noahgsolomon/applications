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
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Button,
} from "frosted-ui";
import {
  Linkedin,
  Github,
  Twitter,
  Building,
  TreePalm,
  GraduationCap,
  Book,
  Info as InfoIcon,
  Plus,
  ChartNetwork,
} from "lucide-react";
import Image from "next/image";

export default function CandidateCard({
  candidate,
  company,
}: {
  candidate: {
    data: InferSelectModel<typeof people>;
    score: number;
    attributions?: { attribution: string; score: number }[];
    from?: string | string[];
    matchedSkills?: { score: number; skill: string }[];
    matchedJobTitle?: { score: number; jobTitle: string };
    matchedLocation?: { score: number; location: string };
    matchedCompanies?: { score: number; company: string }[];
    matchedSchools?: { score: number; school: string }[];
    matchedFieldsOfStudy?: { score: number; fieldOfStudy: string }[];
  };
  company?: InferSelectModel<typeof companyTable>;
}) {
  const {
    data,
    score,
    matchedLocation,
    matchedSkills,
    matchedJobTitle,
    matchedSchools,
    matchedFieldsOfStudy,
  } = candidate;
  const imageUrl =
    data.image ||
    (data.linkedinData && (data.linkedinData as any).photoUrl) ||
    data.githubImage ||
    (data.twitterData && (data.twitterData as any).profile_image_url_https) ||
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
            ?.companyName ? (
            <Flex align="center" gap="2" className="text-primary/60">
              <Building className="size-4" />
              <Text>
                {(data.linkedinData as any)?.positions?.positionHistory?.[0]
                  ?.companyName || ""}
              </Text>
            </Flex>
          ) : data.githubCompany ? (
            <Flex align="center" gap="2" className="text-primary/60">
              <Building className="size-4" />
              <Text>{data.githubCompany}</Text>
            </Flex>
          ) : null}
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
            {score.toFixed(2)}
          </Badge>
          {matchedSkills &&
            matchedSkills.length > 0 &&
            matchedSkills
              .filter((skill) => skill.score > 0)
              .map((skill) => (
                <Badge key={skill.skill} variant="surface" color="pink">
                  {skill.skill}
                </Badge>
              ))}
          {matchedJobTitle && (
            <Badge variant="surface" color="yellow">
              {matchedJobTitle.jobTitle}
            </Badge>
          )}
          {matchedLocation && (
            <Badge variant="surface" color="iris">
              <TreePalm className="size-4" />
              {matchedLocation.location.slice(0, 1).toUpperCase() +
                matchedLocation.location.slice(1).toLowerCase()}
            </Badge>
          )}
          {candidate.data.isWhopUser && (
            <Badge variant="surface" color="orange">
              <Image width={16} height={16} src="/whop.png" alt="Whop" />
              Whop User
            </Badge>
          )}
          {candidate.matchedCompanies &&
            candidate.matchedCompanies.length > 0 &&
            [...new Set(candidate.matchedCompanies.map((c) => c.company))].map(
              (companyName) => (
                <Badge key={companyName} variant="surface" color="blue">
                  <Building className="size-4 mr-1" />
                  {companyName}
                </Badge>
              )
            )}
          {matchedSchools &&
            matchedSchools.length > 0 &&
            matchedSchools.map((school, index) => (
              <Badge key={index} variant="surface" color="green">
                <GraduationCap className="size-4 mr-1" />
                {school.school}
              </Badge>
            ))}
          {matchedFieldsOfStudy &&
            matchedFieldsOfStudy.length > 0 &&
            matchedFieldsOfStudy.map((field, index) => (
              <Badge key={index} variant="surface" color="orange">
                <Book className="size-4 mr-1" />
                {field.fieldOfStudy}
              </Badge>
            ))}
          {candidate.from &&
            (Array.isArray(candidate.from) ? (
              <>
                {candidate.from.map((from) => (
                  <Badge
                    variant="surface"
                    color={
                      from === "linkedin"
                        ? "blue"
                        : from === "github"
                        ? "purple"
                        : "gray"
                    }
                  >
                    {from === "linkedin" ? (
                      <Linkedin className="size-4 mr-1" />
                    ) : from === "github" ? (
                      <Github className="size-4 mr-1" />
                    ) : (
                      <ChartNetwork className="size-4 mr-1" />
                    )}
                    {from + " similar profiles"}
                  </Badge>
                ))}
              </>
            ) : (
              <Badge
                variant="surface"
                color={
                  candidate.from === "linkedin"
                    ? "blue"
                    : candidate.from === "github"
                    ? "purple"
                    : "gray"
                }
              >
                {candidate.from === "linkedin" ? (
                  <Linkedin className="size-4 mr-1" />
                ) : candidate.from === "github" ? (
                  <Github className="size-4 mr-1" />
                ) : (
                  <ChartNetwork className="size-4 mr-1" />
                )}
                {candidate.from + " similar profiles"}
              </Badge>
            ))}
          {candidate.attributions && candidate.attributions.length > 0 && (
            <>
              {candidate.attributions.map((attr, index) => (
                <Badge key={index} variant="surface" color="purple">
                  <Plus className="size-4 mr-1" />
                  {attr.attribution}: {attr.score.toFixed(2)}
                </Badge>
              ))}
            </>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
