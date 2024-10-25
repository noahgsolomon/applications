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
  Users2,
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
    whopMutuals?: { score: number };
    activeGithub?: boolean;
    activeGithubScore?: number;
  };
  company?: InferSelectModel<typeof companyTable>;
}) {
  const {
    data,
    score: candidateScore,
    matchedLocation,
    matchedSkills,
    matchedJobTitle,
    matchedSchools,
    matchedFieldsOfStudy,
    activeGithub,
    activeGithubScore,
    from,
    attributions,
  } = candidate;

  // Update imageUrl to include Twitter profile image
  const imageUrl =
    data.image ||
    (data.linkedinData as any)?.photoUrl ||
    data.githubImage ||
    (data.twitterData as any)?.profile_image_url_https ||
    "";

  // Update displayName to include Twitter name or username
  const displayName =
    data.name ||
    (data.linkedinData as any)?.fullName ||
    data.githubLogin ||
    (data.twitterData as any)?.name ||
    (data.twitterData as any)?.screen_name ||
    "Unknown";

  // Update profile links to include Twitter
  const linkedinUrl =
    data.linkedinUrl || (data.linkedinData as any)?.linkedInUrl || "";

  const githubUrl = data.githubLogin
    ? `https://github.com/${data.githubLogin}`
    : "";

  const twitterUrl = data.twitterUsername
    ? `https://twitter.com/${data.twitterUsername}`
    : (data.twitterData as any)?.screen_name
    ? `https://twitter.com/${(data.twitterData as any).screen_name}`
    : "";

  // Update job title to include Twitter bio if others are missing
  const jobTitle =
    (data.linkedinData as any)?.positions?.positionHistory?.[0]?.title ||
    data.githubBio ||
    (data.twitterData as any)?.description ||
    "";

  // Update company name to include Twitter location if others are missing
  const companyName =
    (data.linkedinData as any)?.positions?.positionHistory?.[0]?.companyName ||
    data.githubCompany ||
    (data.twitterData as any)?.location ||
    "";

  const score =
    typeof candidateScore === "number"
      ? candidateScore.toFixed(2)
      : typeof candidateScore === "string"
      ? parseFloat(candidateScore).toFixed(2)
      : "0";

  return (
    <Card className="shadow-md p-6">
      <Flex direction="row" gap="4" align="start">
        <div className="relative">
          <Avatar
            size="7"
            color="blue"
            fallback={displayName.charAt(0).toUpperCase()}
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
          <Heading size="3">{displayName}</Heading>
          <Flex gap="2">
            {linkedinUrl && (
              <Link href={linkedinUrl} target="_blank">
                <Linkedin className="size-5 text-blue-600 " />
              </Link>
            )}
            {githubUrl && (
              <Link href={githubUrl} target="_blank">
                <Github className="size-5 text-gray-700 " />
              </Link>
            )}
            {twitterUrl && (
              <Link href={twitterUrl} target="_blank">
                <Twitter className="size-5 text-sky-500 " />
              </Link>
            )}
          </Flex>
          <Text className="text-primary/80">{jobTitle}</Text>
          {companyName && (
            <Flex align="center" gap="2" className="text-primary/60">
              <Building className="size-4" />
              <Text>{companyName}</Text>
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
        {/* Display GitHub Bio or Twitter Bio */}
        {data.githubBio ? (
          <Flex
            className="italic text-sm text-primary/60"
            direction="column"
            gap="1"
          >
            <Heading size="2">GitHub Bio</Heading>
            <Text>{data.githubBio}</Text>
          </Flex>
        ) : data.twitterBio ? (
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
        ) : null}

        {/* Rest of your badges and other content */}
        {/* ... */}
      </Flex>
    </Card>
  );
}
