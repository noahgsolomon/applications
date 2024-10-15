"use client";

import { useEffect, useRef, useState } from "react";
import {
  Text,
  Button,
  DialogTrigger,
  DialogContent,
  DialogRoot,
  DialogTitle,
  DialogDescription,
  Flex,
  TextFieldInput,
  DialogClose,
  Badge,
  Avatar,
  ScrollArea,
  TextArea,
  Link,
  Heading,
  Separator,
  Card,
  Checkbox,
} from "frosted-ui";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Building2,
  Check,
  Loader,
  Upload,
  UserRoundSearch,
  X,
  Info,
  Trash2,
  Building,
  Briefcase,
  TreePalm,
  Github,
  Linkedin,
  School,
  GraduationCap,
  Loader2,
  ChartNetwork,
  TwitterIcon,
  Braces,
  MapPin,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import CandidateCard from "./candidate-card";
import { InferSelectModel } from "drizzle-orm";
import {
  candidates,
  company as companyTable,
  people,
} from "@/server/db/schemas/users/schema";
import {
  CompanyFilterReturnType,
  useScrapedDialogStore,
} from "./store/filter-store";
import { Toaster } from "@/components/ui/sonner";
import CompaniesView from "./companies-view";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCompaniesViewStore } from "./companies-view-store";

interface ProfileUrl {
  type: "linkedin" | "github";
  mode: "MANUAL" | "UPLOAD";
  url: string;
}

interface Filters {
  job?: string;
  skills?: string[];
  companies?: Company[];
  otherCompanyNames?: string[];
  location?: string;
  schools?: string[];
  fieldsOfStudy?: string[];
}

interface Company {
  id: string;
  // ... other company properties
}

const toPascalCase = (str: string) => {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

function extractTwitterUsernames(content: string): string[] {
  const twitterRegex =
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(@?\w+)/gi;
  const matches = content.matchAll(twitterRegex);
  return Array.from(matches, (m) => m[1].replace("@", ""));
}

export default function ScrapedDialog() {
  const { filters, setFilters } = useScrapedDialogStore();
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [profileUrls, setProfileUrls] = useState<ProfileUrl[]>([]);
  const [matchedGithubUrls, setMatchedGithubUrls] = useState<string[]>([]);
  const { setCompaniesRemoved } = useCompaniesViewStore();

  const allActiveCompanies = api.outbound.allActiveCompanies.useQuery().data;

  const [whopUser, setWhopUser] = useState(false);
  const [activeGithub, setActiveGithub] = useState(false);
  const [cookdSorting, setCookdSorting] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [candidateMatches, setCandidateMatches] = useState<
    | {
        data: InferSelectModel<typeof people>;
        score: number;
        matchedSkills?: { score: number; skill: string }[];
        matchedJobTitle?: { score: number; jobTitle: string };
        matchedLocation?: { score: number; location: string };
        matchedCompanies?: { score: number; company: string }[];
        matchedSchools?: { score: number; school: string }[];
        matchedFieldsOfStudy?: { score: number; fieldOfStudy: string }[];
        attributions?: { attribution: string; score: number }[];
        from?: "linkedin" | "github" | "filter";
        activeGithub?: boolean;
        activeGithubScore?: number;
      }[]
    | null
  >(null);
  const [ogCandidateMatches, setOgCandidateMatches] = useState<
    | {
        data: InferSelectModel<typeof people>;
        score: number;
        matchedSkills?: { score: number; skill: string }[];
        matchedJobTitle?: { score: number; jobTitle: string };
        matchedLocation?: { score: number; location: string };
        matchedCompanies?: { score: number; company: string }[];
        matchedSchools?: { score: number; school: string }[];
        matchedFieldsOfStudy?: { score: number; fieldOfStudy: string }[];
      }[]
    | null
  >(null);
  const [allIdsResponse, setAllIdsResponse] = useState<
    {
      id: string;
      score: number;
      matchedSkills?: { score: number; skill: string }[];
      matchedJobTitle?: { score: number; jobTitle: string };
      matchedLocation?: { score: number; location: string };
      matchedCompanies?: { score: number; company: string }[];
      matchedSchools?: { score: number; school: string }[];
      matchedFieldsOfStudy?: { score: number; fieldOfStudy: string }[];
    }[]
  >([]);

  const [showGithub, setShowGithub] = useState(false);
  const [showLinkedin, setShowLinkedin] = useState(false);
  const [showTwitter, setShowTwitter] = useState(false);
  const [showWhop, setShowWhop] = useState(false);
  const [showActiveGithub, setShowActiveGithub] = useState(false);
  const [showMatchingLocation, setShowMatchingLocation] = useState(false);
  const [twitterUsernames, setTwitterUsernames] = useState<string[]>([]);

  // Function to initialize filterWeights based on active filters
  const initializeFilterWeights = () => {
    let weights: { [key: string]: number | { [skillName: string]: number } } =
      {};

    if (filters?.job) {
      weights.job = 0.2;
    }
    if (
      (filters?.companies && filters.companies.length > 0) ||
      (filters?.otherCompanyNames && filters?.otherCompanyNames.length > 0)
    ) {
      weights.companies = 0.1;
    }
    if (filters?.location) {
      weights.location = 0.15;
    }
    if (filters?.schools && filters?.schools.length > 0) {
      weights.schools = 0.1;
    }
    if (filters?.fieldsOfStudy && filters?.fieldsOfStudy.length > 0) {
      weights.fieldsOfStudy = 0.15;
    }
    if (whopUser) {
      weights.whopUser = 0.2;
    }
    if (activeGithub) {
      weights.activeGithub = 0.1;
    }

    // Handle individual skill weights
    if (filters?.skills && filters.skills.length > 0) {
      const skillWeight = 0.3;
      const numSkills = filters.skills.length;
      const initialSkillWeight = skillWeight / numSkills;

      weights.skills = filters.skills.reduce(
        (acc: { [skillName: string]: number }, skill: string) => {
          acc[skill] = initialSkillWeight;
          return acc;
        },
        {} as { [skillName: string]: number }
      );
    }

    const totalWeight = Object.values(weights)
      .map((w) =>
        typeof w === "number" ? w : Object.values(w).reduce((a, b) => a + b, 0)
      )
      .reduce((sum, w) => sum + w, 0);

    // Normalize weights to sum to 1
    const normalizedWeights = Object.fromEntries(
      Object.entries(weights).map(([key, w]) => [
        key,
        typeof w === "number"
          ? w / totalWeight
          : Object.fromEntries(
              Object.entries(w).map(([skill, weight]) => [
                skill,
                weight / totalWeight,
              ])
            ),
      ])
    );

    return normalizedWeights;
  };

  // Initialize filterWeights
  const [filterWeights, setFilterWeights] = useState<{
    [key: string]: number | { [skillName: string]: number };
  }>(initializeFilterWeights());

  // Update filterWeights whenever filters or whopUser change
  useEffect(() => {
    setFilterWeights(initializeFilterWeights());
  }, [filters, whopUser, activeGithub]);

  // Function to handle weight changes
  const handleWeightChange = (
    filterType: string,
    value: number,
    skillName?: string
  ) => {
    let oldWeight;
    if (skillName) {
      oldWeight = (filterWeights.skills as { [key: string]: number })[
        skillName
      ];
    } else {
      oldWeight = filterWeights[filterType] as number;
    }

    if (oldWeight === undefined) {
      return;
    }
    const delta = value - oldWeight;

    // Calculate total other weights
    const otherWeights = Object.entries(filterWeights)
      .filter(([key]) => key !== filterType && key !== "skills")
      .map(([_, w]) => (typeof w === "number" ? w : 0))
      .reduce((sum, w) => sum + w, 0);

    let totalOtherSkillWeights = 0;
    if (filterWeights.skills) {
      totalOtherSkillWeights = Object.entries(
        filterWeights.skills as { [key: string]: number }
      )
        .filter(([key]) => key !== skillName)
        .map(([_, w]) => w)
        .reduce((sum, w) => sum + w, 0);
    }

    const totalOtherWeights = otherWeights + totalOtherSkillWeights;

    let newWeights = { ...filterWeights };

    if (skillName) {
      (newWeights.skills as { [key: string]: number })[skillName] = value;
    } else {
      newWeights[filterType] = value;
    }

    // Adjust other weights proportionally
    Object.keys(newWeights).forEach((key) => {
      if (
        key !== filterType &&
        key !== "skills" &&
        typeof newWeights[key] === "number"
      ) {
        const weight = newWeights[key] as number;
        const adjustedWeight = weight - (weight / totalOtherWeights) * delta;
        newWeights[key] = Math.max(adjustedWeight, 0);
      } else if (key === "skills") {
        const skillsWeights = newWeights.skills as { [key: string]: number };
        Object.keys(skillsWeights).forEach((skill) => {
          if (skill !== skillName) {
            const weight = skillsWeights[skill];
            const adjustedWeight =
              weight - (weight / totalOtherWeights) * delta;
            skillsWeights[skill] = Math.max(adjustedWeight, 0);
          }
        });
      }
    });

    // Recalculate total weight and normalize if necessary
    let totalWeight = Object.values(newWeights)
      .map((w) =>
        typeof w === "number" ? w : Object.values(w).reduce((a, b) => a + b, 0)
      )
      .reduce((sum, w) => sum + w, 0);

    // Normalize weights to sum to 1
    newWeights = Object.fromEntries(
      Object.entries(newWeights).map(([key, w]) => [
        key,
        typeof w === "number"
          ? w / totalWeight
          : Object.fromEntries(
              Object.entries(w).map(([skill, weight]) => [
                skill,
                weight / totalWeight,
              ])
            ),
      ])
    );

    setFilterWeights(newWeights);
  };

  const getPendingSimilarProfilesQuery =
    api.outbound.getPendingSimilarProfiles.useQuery(undefined, {
      refetchInterval: 2500,
    });

  const getAbsoluteFilteredTopCandidatesMutation =
    api.outbound.getAbsoluteFilteredTopCandidates.useMutation({
      onSuccess: (data) => {
        setCandidateMatches(data);
      },
      onError: (error) => {
        console.error("Error fetching top candidates:", error);
      },
    });

  useEffect(() => {
    if (cookdSorting) {
      setCookdSorting(false);
    }

    if (
      getPendingSimilarProfilesQuery.data &&
      getPendingSimilarProfilesQuery.data[0]
    ) {
      setLoading(true);
    }
    if (
      getPendingSimilarProfilesQuery.data &&
      getPendingSimilarProfilesQuery.data[0]?.error
    ) {
      toast.error("Internal Server Error");

      deletePendingSimilarProfilesMutation.mutate({
        id: getPendingSimilarProfilesQuery.data[0].id,
      });

      setLoading(false);
    } else if (
      getPendingSimilarProfilesQuery.data &&
      getPendingSimilarProfilesQuery.data[0]?.success
    ) {
      toast.success("Search completed!");

      setCandidateMatches(
        getPendingSimilarProfilesQuery.data[0].response as
          | {
              data: InferSelectModel<typeof people>;
              score: number;
            }[]
          | null
      );
      setOgCandidateMatches(
        getPendingSimilarProfilesQuery.data[0].response as
          | {
              data: InferSelectModel<typeof people>;
              score: number;
            }[]
          | null
      );
      setAllIdsResponse(
        getPendingSimilarProfilesQuery.data[0].allIdsResponse ??
          ([] as {
            id: string;
            score: number;
            matchedSkills?: { score: number; skill: string }[];
            matchedJobTitle?: { score: number; jobTitle: string };
            matchedLocation?: { score: number; location: string };
            matchedCompanies?: { score: number; company: string }[];
            matchedSchools?: { score: number; school: string }[];
            matchedFieldsOfStudy?: { score: number; fieldOfStudy: string }[];
          }[])
      );
      setLoading(false);

      deletePendingSimilarProfilesMutation.mutate({
        id: getPendingSimilarProfilesQuery.data[0].id,
      });
    }
  }, [
    getPendingSimilarProfilesQuery.data,
    getPendingSimilarProfilesQuery.isFetched,
    getPendingSimilarProfilesQuery.status,
  ]);

  const deletePendingSimilarProfilesMutation =
    api.outbound.deletePendingSimilarProfiles.useMutation({
      onSuccess: () => {
        getPendingSimilarProfilesQuery.refetch();
      },
      onError: () => {},
    });

  const insertIntoQueueMutation = api.outbound.insertIntoQueue.useMutation({
    onSuccess: (data) => {
      if (data?.success) {
        toast.success("Message sent successfully");
      } else {
        setLoading(false);
        console.error("Error sending message:", error);
        toast.error("Failed to send message");
      }
    },
    onError: (error) => {
      console.error("Error sending message:", error);
      setLoading(false);
      toast.error("Failed to send message");
    },
  });

  const handleToggle = (type: "whopUser" | "activeGithub") => {
    if (type === "whopUser") {
      setWhopUser((prev) => !prev);
    }
    if (type === "activeGithub") {
      setActiveGithub((prev) => !prev);
    }
  };

  const companyFilterMutation = api.outbound.companyFilter.useMutation({
    onSuccess: (data: CompanyFilterReturnType) => {
      if (!data.valid) {
        setError(data.message);
      }
      if (
        !filters?.companies ||
        filters.companies.length === 0 ||
        filters.companies.length === allActiveCompanies?.length ||
        data.companies.length < (allActiveCompanies?.length ?? 0)
      ) {
        setFilters(data);
        if (
          data.companies &&
          data.companies.length > 0 &&
          data.companies.length < (allActiveCompanies?.length ?? 0)
        ) {
          setCompaniesRemoved(false);
        }
      } else {
        //@ts-ignore
        setFilters({
          ...data,
          companies: filters?.companies,
        });
      }
      setQuery("");
      setFiltersLoading(false);
    },
    onError: () => {
      toast.error("Internal server error");
      setFiltersLoading(false);
      setQuery("");
    },
  });

  const handleFilter = () => {
    if (!query) {
      setError("Search query cannot be empty.");
      return;
    }
    setFiltersLoading(true);

    setError("");
    companyFilterMutation.mutate({
      query,
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [manualUrls, setManualUrls] = useState("");

  const normalizeUrl = (url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `https://${url}`;
    }
    return url;
  };

  const extractUrls = (
    content: string
  ): {
    linkedinUrls: string[];
    githubUrls: string[];
    twitterUsernames: string[];
  } => {
    const linkedinRegex =
      /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-%.]+/gi;
    const githubRegex =
      /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9-]+/gi;

    const linkedinMatches = content.match(linkedinRegex) || [];
    const githubMatches = content.match(githubRegex) || [];
    const twitterUsernames = extractTwitterUsernames(content);

    return {
      linkedinUrls: [...new Set(linkedinMatches)].map(normalizeUrl),
      githubUrls: [...new Set(githubMatches)].map(normalizeUrl),
      twitterUsernames: [...new Set(twitterUsernames)],
    };
  };

  const handleManualUrlsChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    setManualUrls(e.target.value);
    const { linkedinUrls, githubUrls, twitterUsernames } = extractUrls(
      e.target.value
    );

    const newProfileUrls: ProfileUrl[] = [
      ...linkedinUrls.map((url) => ({
        type: "linkedin" as const,
        mode: "MANUAL" as const,
        url,
      })),
      ...githubUrls.map((url) => ({
        type: "github" as const,
        mode: "MANUAL" as const,
        url,
      })),
    ];

    setProfileUrls((prev) =>
      [
        ...prev.filter((url) => url.mode === "UPLOAD"),
        ...newProfileUrls,
      ].filter(
        (url, index, self) =>
          index ===
          self.findIndex((t) => t.url === url.url && t.type === url.type)
      )
    );

    setTwitterUsernames(twitterUsernames);
  };

  const handleFileProcessing = async (file: File) => {
    setError("");
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const { linkedinUrls, githubUrls, twitterUsernames } =
        extractUrls(content);
      if (
        linkedinUrls.length > 0 ||
        githubUrls.length > 0 ||
        twitterUsernames.length > 0
      ) {
        const newProfileUrls: ProfileUrl[] = [
          ...linkedinUrls.map((url) => ({
            type: "linkedin" as const,
            mode: "UPLOAD" as const,
            url,
          })),
          ...githubUrls.map((url) => ({
            type: "github" as const,
            mode: "UPLOAD" as const,
            url,
          })),
        ];
        setProfileUrls((prev) =>
          [...prev, ...newProfileUrls].filter(
            (url, index, self) =>
              index ===
              self.findIndex((t) => t.url === url.url && t.type === url.type)
          )
        );
        setTwitterUsernames(twitterUsernames);
      } else {
        setError(
          "No valid LinkedIn, GitHub, or Twitter URLs found in the file."
        );
      }
    };
    reader.onerror = () => {
      setError("Error reading file. Please try again.");
    };
    reader.readAsText(file);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileProcessing(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileProcessing(file);
    }
  };

  const findSimilarProfiles = async (profileUrls: ProfileUrl[]) => {
    setError("");
    setFlushing(false);

    const linkedinUrls = profileUrls
      .filter((url) => url.type === "linkedin")
      .map((url) => url.url);
    const githubUrls = profileUrls
      .filter((url) => url.type === "github")
      .map((url) => url.url);

    const payload: any = {};
    if (linkedinUrls.length > 0) {
      payload.linkedinUrls = linkedinUrls;
    }

    if (githubUrls.length > 0) {
      payload.githubUrls = githubUrls;
    }

    if (twitterUsernames.length > 0) {
      payload.twitterUsernames = twitterUsernames;
    }

    if (filters) {
      payload.filterCriteria = {
        query,
        companyIds: {
          values: (filters?.companies ?? []).map((company) => company.id) ?? [],
          weight: filterWeights.companies as number,
        },
        otherCompanyNames: {
          values: filters?.otherCompanyNames ?? [],
          weight: filterWeights.companies as number,
        },
        job: {
          value: filters?.job ?? "",
          weight: filterWeights.job as number,
        },
        location: {
          value: filters?.location,
          weight: filterWeights.location as number,
        },
        schools: {
          values: filters?.schools ?? [],
          weight: filterWeights.schools as number,
        },
        fieldsOfStudy: {
          values: filters?.fieldsOfStudy ?? [],
          weight: filterWeights.fieldsOfStudy as number,
        },
        whopUser: {
          value: whopUser,
          weight: filterWeights.whopUser as number,
        },
        activeGithub: {
          value: activeGithub,
          weight: filterWeights.activeGithub as number,
        },
      };

      if (filters?.skills && filterWeights.skills) {
        const skillsWeights = filterWeights.skills as { [key: string]: number };
        payload.filterCriteria.skills = {
          values: filters.skills.map((skill: string) => ({
            skill,
            weight: skillsWeights[skill],
          })),
        };
      }
    }

    if (
      Object.keys(payload).length === 0 ||
      (!linkedinUrls.length && !githubUrls.length && !payload.filterCriteria)
    ) {
      setError("Please provide profile URLs or filters.");
      return;
    }

    insertIntoQueueMutation.mutate({
      payload,
    });
  };

  const handleProfileSearch = () => {
    setCandidateMatches(null);
    setOgCandidateMatches(null);
    setAllIdsResponse([]);
    setError("");
    setLoading(true);
    findSimilarProfiles(profileUrls);
  };

  useEffect(() => {
    if (
      !showGithub &&
      !showLinkedin &&
      !showTwitter &&
      !showWhop &&
      !showActiveGithub &&
      !showMatchingLocation
    ) {
      setCandidateMatches(ogCandidateMatches);
    }
  }, [
    showGithub,
    showLinkedin,
    showTwitter,
    showWhop,
    showActiveGithub,
    showMatchingLocation,
  ]);

  return (
    <ScrollArea>
      <Card
        size="5"
        className="my-36 p-4 w-[90%] sm:w-[75%] lg:w-[800px] mx-auto shadow-md"
      >
        <Toaster richColors className="z-[99999]" />
        <Heading size={"6"}>Candidate Search</Heading>
        <Text className="text-primary/60">
          Provide details to search for candidates.
        </Text>
        <Separator />

        <Flex direction="column" gap="4" mt="4">
          {/* Search Query Section */}
          <Flex direction="column" gap="2">
            <Flex align="center">
              <Text as="div" size="2" weight="bold">
                Search Query
              </Text>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-4 ml-1 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Enter job title, companies, and/or skills to search for
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Flex>
            <TextFieldInput
              placeholder="e.g., Software Engineer, Google"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant="classic"
              size="2"
              onClick={handleFilter}
              disabled={filtersLoading || !query.trim()}
              style={{ alignSelf: "flex-start", cursor: "pointer" }}
            >
              {filtersLoading ? (
                <Loader className="size-4 animate-spin" />
              ) : (
                "Generate Filters"
              )}
            </Button>

            <Flex wrap="wrap" gap="2" mt="2">
              <DialogRoot>
                <DialogTrigger>
                  <Button
                    style={{ cursor: "pointer" }}
                    variant="surface"
                    color="yellow"
                  >
                    <div className="items-center flex flex-row gap-2">
                      <Building className="size-4" />
                      Cracked Companies List
                    </div>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <CompaniesView />

                  <DialogClose>
                    <Button style={{ cursor: "pointer" }} variant="soft" mt="4">
                      Close
                    </Button>
                  </DialogClose>
                </DialogContent>
              </DialogRoot>
              {filters && filters.job && (
                <Button
                  style={{ cursor: "pointer" }}
                  onClick={() => setFilters({ ...filters, job: "" })}
                  className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                  color="orange"
                  variant="surface"
                >
                  <Text className="items-center flex flex-row gap-2">
                    <Briefcase className="size-4" />
                    {filters.job
                      .split(" ")
                      .map(
                        (word: string) =>
                          word.charAt(0).toUpperCase() + word.slice(1)
                      )
                      .join(" ")}
                  </Text>
                </Button>
              )}
              {filters &&
                (filters.skills?.length ?? 0) > 0 &&
                filters?.skills.map((skill: string) => (
                  <Button
                    style={{ cursor: "pointer" }}
                    className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                    onClick={() =>
                      setFilters({
                        ...filters,
                        skills: filters.skills.filter(
                          (s: string) => s !== skill
                        ),
                      })
                    }
                    color="pink"
                    key={skill}
                    variant="surface"
                  >
                    <Braces className="size-4" />
                    <Text>{toPascalCase(skill)}</Text>
                  </Button>
                ))}

              {filters &&
                ((filters.companies &&
                  filters.companies.length > 0 &&
                  filters.companies.length !== allActiveCompanies?.length) ||
                  filters.otherCompanyNames?.length > 0 ||
                  filters.schools?.length > 0 ||
                  filters.fieldsOfStudy?.length > 0 ||
                  filters.location ||
                  filters.skills?.length > 0) && (
                  <>
                    {filters.location ? (
                      <Button
                        variant="surface"
                        size="2"
                        style={{ cursor: "pointer" }}
                        color={"iris"}
                        className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                        onClick={() => {
                          setFilters({ ...filters, location: "" });
                        }}
                      >
                        <TreePalm className="size-4" />
                        Near {filters.location}
                      </Button>
                    ) : null}
                    {filters &&
                      filters.schools &&
                      filters.schools.length > 0 &&
                      filters.schools.map((school: string, index: number) => (
                        <Button
                          key={index}
                          variant="surface"
                          size="2"
                          style={{ cursor: "pointer" }}
                          color={"cyan"}
                          className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                          onClick={() => {
                            setFilters({
                              ...filters,
                              schools: filters.schools.filter(
                                (s: string) => s !== school
                              ),
                            });
                          }}
                        >
                          <School className="size-4" />
                          {school}
                        </Button>
                      ))}
                    {filters &&
                      filters.fieldsOfStudy &&
                      filters.fieldsOfStudy.length > 0 &&
                      filters.fieldsOfStudy.map(
                        (field: string, index: number) => (
                          <Button
                            key={index}
                            variant="surface"
                            size="2"
                            style={{ cursor: "pointer" }}
                            color={"cyan"}
                            className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                            onClick={() => {
                              setFilters({
                                ...filters,
                                fieldsOfStudy: filters.fieldsOfStudy.filter(
                                  (f: string) => f !== field
                                ),
                              });
                            }}
                          >
                            <GraduationCap className="size-4" />
                            {field}
                          </Button>
                        )
                      )}

                    <DialogRoot>
                      <DialogTrigger>
                        <Button
                          style={{ cursor: "pointer" }}
                          variant="surface"
                          color="gray"
                        >
                          <ChartNetwork className="size-4" />
                          Filter Weights
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <Flex direction="column" gap="2" mt="4">
                          <Text as="div" size="2" weight="bold">
                            Filter Weights
                          </Text>
                          <Text className="text-primary/60">
                            Adjust the weight of each filter type.
                          </Text>

                          {Object.keys(filterWeights).map((filterType) => {
                            if (filterType !== "skills") {
                              const buttonColor = (() => {
                                switch (filterType) {
                                  case "job":
                                    return "orange";
                                  case "companies":
                                    return "purple";
                                  case "location":
                                    return "iris";
                                  case "schools":
                                    return "cyan";
                                  case "fieldsOfStudy":
                                    return "cyan";
                                  case "whopUser":
                                    return "orange";
                                  case "activeGithub":
                                    return "violet";
                                  default:
                                    return "gray";
                                }
                              })();

                              const Whop = () => (
                                <Image
                                  src={"/whop.png"}
                                  width={30}
                                  height={30}
                                  alt="whop logo"
                                />
                              );

                              const ButtonIcon = (() => {
                                switch (filterType) {
                                  case "job":
                                    return Briefcase;
                                  case "companies":
                                    return Building2;
                                  case "location":
                                    return TreePalm;
                                  case "schools":
                                    return School;
                                  case "fieldsOfStudy":
                                    return GraduationCap;
                                  case "whopUser":
                                    return Whop;
                                  case "activeGithub":
                                    return Github;
                                  default:
                                    return null;
                                }
                              })();

                              const buttonText = (() => {
                                switch (filterType) {
                                  case "job":
                                    return filters?.job || "Job";
                                  case "companies":
                                    return filters?.companies.length === 1
                                      ? filters?.companies[0].name
                                      : "Companies";
                                  case "location":
                                    return filters?.location || "Location";
                                  case "fieldsOfStudy":
                                    return filters?.fieldsOfStudy.length === 1
                                      ? filters?.fieldsOfStudy[0]
                                      : "Fields of Study";
                                  case "whopUser":
                                    return "Whop Mode";
                                  case "schools":
                                    return filters?.schools.length === 1
                                      ? filters?.schools[0]
                                      : "Schools";
                                  case "activeGithub":
                                    return "Active Github";
                                  default:
                                    return toPascalCase(filterType);
                                }
                              })();

                              return (
                                <Flex
                                  key={filterType}
                                  align="center"
                                  gap="2"
                                  mt="2"
                                >
                                  <Button
                                    variant="surface"
                                    color={buttonColor}
                                    style={{ cursor: "pointer" }}
                                  >
                                    {ButtonIcon && (
                                      <ButtonIcon className="size-4 mr-1" />
                                    )}
                                    {buttonText}
                                  </Button>
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    style={{ cursor: "pointer", flex: 1 }}
                                    value={filterWeights[filterType] as number}
                                    onChange={(e) =>
                                      handleWeightChange(
                                        filterType,
                                        parseFloat(e.target.value)
                                      )
                                    }
                                  />
                                  <Text
                                    style={{
                                      width: "50px",
                                      textAlign: "right",
                                    }}
                                  >
                                    {(
                                      (filterWeights[filterType] as number) *
                                      100
                                    ).toFixed(0)}
                                    %
                                  </Text>
                                </Flex>
                              );
                            } else {
                              // Handle individual skills
                              const skillsWeights = filterWeights.skills as {
                                [key: string]: number;
                              };
                              return Object.keys(skillsWeights).map(
                                (skillName) => (
                                  <Flex
                                    key={skillName}
                                    align="center"
                                    gap="2"
                                    mt="2"
                                  >
                                    <Button
                                      style={{ cursor: "pointer" }}
                                      color="pink"
                                      key={skillName}
                                      variant="surface"
                                    >
                                      <Braces className="size-4" />
                                      <Text>{toPascalCase(skillName)}</Text>
                                    </Button>
                                    <input
                                      type="range"
                                      min={0}
                                      max={1}
                                      step={0.01}
                                      style={{ cursor: "pointer", flex: 1 }}
                                      value={skillsWeights[skillName]}
                                      onChange={(e) =>
                                        handleWeightChange(
                                          "skills",
                                          parseFloat(e.target.value),
                                          skillName
                                        )
                                      }
                                    />
                                    <Text
                                      style={{
                                        width: "50px",
                                        textAlign: "right",
                                      }}
                                    >
                                      {(skillsWeights[skillName] * 100).toFixed(
                                        0
                                      )}
                                      %
                                    </Text>
                                  </Flex>
                                )
                              );
                            }
                          })}
                        </Flex>
                      </DialogContent>
                    </DialogRoot>
                    <Button
                      variant="surface"
                      size="2"
                      style={{ cursor: "pointer" }}
                      color={whopUser ? "orange" : "gray"}
                      onClick={() => handleToggle("whopUser")}
                    >
                      {whopUser ? (
                        <Check className="size-4 text-green-500" />
                      ) : (
                        <X className="size-4 text-red-500" />
                      )}
                      <Image
                        src={"/whop.png"}
                        width={30}
                        height={30}
                        alt="whop logo"
                      />
                      Whop Mode
                    </Button>
                    <Button
                      variant="surface"
                      size="2"
                      style={{ cursor: "pointer" }}
                      color={activeGithub ? "violet" : "gray"}
                      onClick={() => handleToggle("activeGithub")}
                    >
                      {activeGithub ? (
                        <Check className="size-4 text-green-500" />
                      ) : (
                        <X className="size-4 text-red-500" />
                      )}
                      <Github className="size-4" />
                      Active Github
                    </Button>
                    <Button
                      variant="surface"
                      color="gray"
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setFilters(null);
                        setFilterWeights({
                          job: 1 / 8,
                          skills: 1 / 8,
                          companies: 1 / 8,
                          location: 1 / 8,
                          schools: 1 / 8,
                          fieldsOfStudy: 1 / 8,
                          whopUser: 1 / 8,
                          activeGithub: 1 / 8,
                        });
                      }}
                    >
                      <X className="size-4" />
                      Clear filters
                    </Button>
                  </>
                )}

              {filters &&
                filters.otherCompanyNames &&
                filters.otherCompanyNames.length > 0 &&
                filters.otherCompanyNames.map(
                  (company: string, index: number) => (
                    <Button
                      key={index}
                      variant="surface"
                      size="2"
                      style={{ cursor: "pointer" }}
                      color="purple"
                      className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                      onClick={() => {
                        setFilters({
                          ...filters,
                          otherCompanyNames: filters.otherCompanyNames.filter(
                            (c: string) => c !== company
                          ),
                        });
                      }}
                    >
                      <Building2 className="size-4 mr-1" />
                      {company}
                    </Button>
                  )
                )}
            </Flex>
          </Flex>

          <Separator />

          {/* Profile URLs Section */}
          <Accordion type="single" collapsible>
            <AccordionItem value="urls">
              <AccordionTrigger>
                <Text size="2" weight="bold">
                  Upload Ideal LinkedIn, GitHub, and Twitter Candidate URLs
                </Text>
              </AccordionTrigger>
              <AccordionContent>
                <TextArea
                  placeholder="Paste URLs here (one per line)"
                  value={manualUrls}
                  onChange={handleManualUrlsChange}
                  style={{ minHeight: "100px" }}
                  disabled={loading}
                />
                <Flex align="center" gap="2" mt="2">
                  <div
                    className={`border-dashed p-4 py-6 bg-secondary/60 cursor-pointer rounded-lg border-2 transition-all duration-300 ease-in-out
                          flex flex-col gap-2 items-center text-primary/60 justify-center w-full`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-6" />
                    <p className={`text-sm text-center`}>
                      Drag and drop your file here (.txt, .csv)
                      <br />
                      or click to upload
                    </p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept=".txt,.csv"
                      style={{ display: "none" }}
                    />
                  </div>
                </Flex>
                {(profileUrls.length > 0 || twitterUsernames.length > 0) && (
                  <Flex direction="column" gap="2" mt="2">
                    <Text size="2">
                      {profileUrls.length} unique LinkedIn and GitHub URLs
                      loaded
                      {twitterUsernames.length > 0 &&
                        `, ${twitterUsernames.length} Twitter usernames`}
                    </Text>
                    <Flex wrap="wrap" gap="2">
                      {profileUrls.map((urlObj, index) => (
                        <Button
                          key={index}
                          variant="surface"
                          color={urlObj.type === "linkedin" ? "blue" : "green"}
                          style={{ cursor: "pointer" }}
                          className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                          onClick={() => {
                            setProfileUrls(
                              profileUrls.filter((u) => u !== urlObj)
                            );
                            setManualUrls(
                              manualUrls
                                .replace(urlObj.url, "")
                                .replace(urlObj.url.replace("https://", ""), "")
                            );
                          }}
                        >
                          {urlObj.type === "linkedin" ? (
                            <Linkedin className="size-4 mr-1" />
                          ) : (
                            <Github className="size-4 mr-1" />
                          )}
                          {urlObj.url.split("/").pop()}
                        </Button>
                      ))}
                      {twitterUsernames.map((username, index) => (
                        <Button
                          key={`twitter-${index}`}
                          variant="surface"
                          color="sky"
                          style={{ cursor: "pointer" }}
                          className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                          onClick={() => {
                            setTwitterUsernames(
                              twitterUsernames.filter((u) => u !== username)
                            );
                            setManualUrls(
                              manualUrls
                                .replace(`https://twitter.com/${username}`, "")
                                .replace(`https://x.com/${username}`, "")
                                .replace(`@${username}`, "")
                                .replace(username, "")
                            );
                          }}
                        >
                          <TwitterIcon className="size-4 mr-1" />
                          {username}
                        </Button>
                      ))}
                      <Button
                        variant="surface"
                        color="gray"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setProfileUrls([]);
                          setTwitterUsernames([]);
                          setManualUrls("");
                        }}
                      >
                        <X className="size-4" />
                        Clear URLs
                      </Button>
                    </Flex>
                  </Flex>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Error Message */}
          {error && (
            <Text size="2" color="red" mt="2">
              {error}
            </Text>
          )}

          <Separator />

          {/* Action Buttons */}
          <Flex justify="end" gap="2">
            {getPendingSimilarProfilesQuery.data &&
              getPendingSimilarProfilesQuery.data[0] &&
              !flushing && (
                <Button
                  variant="classic"
                  size="2"
                  color="red"
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    for (const profileQuery of getPendingSimilarProfilesQuery.data) {
                      deletePendingSimilarProfilesMutation.mutate({
                        id: profileQuery.id,
                      });
                    }
                    setLoading(false);
                    setFlushing(true);
                  }}
                >
                  Cancel
                </Button>
              )}
            <Button
              variant="classic"
              size="2"
              style={{ cursor: "pointer" }}
              onClick={() => {
                if (loading) return;
                if (
                  query.trim() === "" &&
                  profileUrls.length === 0 &&
                  !filters
                ) {
                  setError("Please enter a search query or profile URLs.");
                  return;
                }
                setError("");
                handleProfileSearch();
              }}
              disabled={loading || (profileUrls.length === 0 && !filters)}
            >
              {loading ? <Loader className="size-4 animate-spin" /> : "Search"}
            </Button>
          </Flex>
        </Flex>

        {/* Candidate List Dialog */}
        {(candidateMatches || matchedGithubUrls.length > 0) && (
          <DialogRoot>
            <DialogTrigger>
              <Button style={{ cursor: "pointer" }} variant="classic" mt="4">
                View Candidates
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Candidates</DialogTitle>
              <DialogDescription>
                List of candidates sorted by relevance.
              </DialogDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="surface"
                  size="2"
                  style={{ cursor: "pointer" }}
                  color={showGithub ? "violet" : "gray"}
                  onClick={() => {
                    if (
                      !showGithub ||
                      showLinkedin ||
                      showTwitter ||
                      showWhop ||
                      showActiveGithub ||
                      showMatchingLocation
                    ) {
                      getAbsoluteFilteredTopCandidatesMutation.mutate({
                        allIdsResponse,
                        showGithub: !showGithub,
                        showLinkedin,
                        showTwitter,
                        showWhop,
                        showActiveGithub,
                        showMatchingLocation,
                      });
                    } else {
                      setCandidateMatches(ogCandidateMatches);
                    }
                    setShowGithub(!showGithub);
                  }}
                >
                  {showGithub ? (
                    <Check className="size-4 text-green-500" />
                  ) : null}
                  <Github className="size-4" />
                  Has GitHub
                </Button>
                <Button
                  variant="surface"
                  size="2"
                  style={{ cursor: "pointer" }}
                  color={showLinkedin ? "blue" : "gray"}
                  onClick={() => {
                    if (
                      !showLinkedin ||
                      showGithub ||
                      showTwitter ||
                      showWhop ||
                      showActiveGithub ||
                      showMatchingLocation
                    ) {
                      getAbsoluteFilteredTopCandidatesMutation.mutate({
                        allIdsResponse,
                        showGithub,
                        showLinkedin: !showLinkedin,
                        showTwitter,
                        showWhop,
                        showActiveGithub,
                        showMatchingLocation,
                      });
                    } else {
                      setCandidateMatches(ogCandidateMatches);
                    }
                    setShowLinkedin(!showLinkedin);
                  }}
                >
                  {showLinkedin ? (
                    <Check className="size-4 text-green-500" />
                  ) : null}
                  <Linkedin className="size-4" />
                  Has LinkedIn
                </Button>
                <Button
                  variant="surface"
                  size="2"
                  style={{ cursor: "pointer" }}
                  color={showTwitter ? "sky" : "gray"}
                  onClick={() => {
                    setShowTwitter(!showTwitter);
                    if (
                      !showTwitter ||
                      showGithub ||
                      showLinkedin ||
                      showWhop ||
                      showActiveGithub ||
                      showMatchingLocation
                    ) {
                      getAbsoluteFilteredTopCandidatesMutation.mutate({
                        allIdsResponse,
                        showGithub,
                        showLinkedin,
                        showTwitter: !showTwitter,
                        showWhop,
                        showActiveGithub,
                        showMatchingLocation,
                      });
                    } else {
                      setCandidateMatches(ogCandidateMatches);
                    }
                    setShowTwitter(!showTwitter);
                  }}
                >
                  {showTwitter ? (
                    <Check className="size-4 text-green-500" />
                  ) : null}
                  <TwitterIcon className="size-4" />
                  Has Twitter
                </Button>
                <Button
                  variant="surface"
                  size="2"
                  style={{ cursor: "pointer" }}
                  color={showWhop ? "green" : "gray"}
                  onClick={() => {
                    if (
                      !showWhop ||
                      showGithub ||
                      showLinkedin ||
                      showTwitter ||
                      showActiveGithub ||
                      showMatchingLocation
                    ) {
                      getAbsoluteFilteredTopCandidatesMutation.mutate({
                        allIdsResponse,
                        showGithub,
                        showLinkedin,
                        showTwitter,
                        showWhop: !showWhop,
                        showActiveGithub,
                        showMatchingLocation,
                      });
                    } else {
                      setCandidateMatches(ogCandidateMatches);
                    }
                    setShowWhop(!showWhop);
                  }}
                >
                  {showWhop ? (
                    <Check className="size-4 text-green-500" />
                  ) : null}
                  <Image
                    src={"/whop.png"}
                    width={30}
                    height={30}
                    alt="whop logo"
                  />
                  Has Whop
                </Button>
                <Button
                  variant="surface"
                  size="2"
                  style={{ cursor: "pointer" }}
                  color={showActiveGithub ? "violet" : "gray"}
                  onClick={() => {
                    if (
                      !showActiveGithub ||
                      showGithub ||
                      showLinkedin ||
                      showTwitter ||
                      showWhop ||
                      showMatchingLocation
                    ) {
                      getAbsoluteFilteredTopCandidatesMutation.mutate({
                        allIdsResponse,
                        showGithub,
                        showLinkedin,
                        showTwitter,
                        showWhop,
                        showActiveGithub: !showActiveGithub,
                        showMatchingLocation,
                      });
                    } else {
                      setCandidateMatches(ogCandidateMatches);
                    }
                    setShowActiveGithub(!showActiveGithub);
                  }}
                >
                  {showActiveGithub ? (
                    <Check className="size-4 text-green-500" />
                  ) : null}
                  <Github className="size-4" />
                  Active Github
                </Button>
                <Button
                  variant="surface"
                  size="2"
                  style={{ cursor: "pointer" }}
                  color={showMatchingLocation ? "green" : "gray"}
                  onClick={() => {
                    if (
                      !showMatchingLocation ||
                      showGithub ||
                      showLinkedin ||
                      showTwitter ||
                      showWhop ||
                      showActiveGithub
                    ) {
                      getAbsoluteFilteredTopCandidatesMutation.mutate({
                        allIdsResponse,
                        showGithub,
                        showLinkedin,
                        showTwitter,
                        showWhop,
                        showActiveGithub,
                        showMatchingLocation: !showMatchingLocation,
                      });
                    }
                    setShowMatchingLocation(!showMatchingLocation);
                  }}
                >
                  {showMatchingLocation ? (
                    <Check className="size-4 text-green-500" />
                  ) : null}
                  <MapPin className="size-4 mr-1" />
                  Matching Location
                </Button>
              </div>
              <ScrollArea className="py-4">
                <Flex direction="column" gap="2">
                  {getAbsoluteFilteredTopCandidatesMutation.isPending ? (
                    <Flex
                      direction="column"
                      align="center"
                      justify="center"
                      className="py-8"
                    >
                      <Loader className="h-8 w-8 animate-spin text-primary" />
                      <Text size="2" className="mt-2">
                        Loading candidates...
                      </Text>
                    </Flex>
                  ) : candidateMatches?.length === 0 ? (
                    "No matches found."
                  ) : (
                    candidateMatches
                      ?.sort((a, b) => b.score - a.score)
                      .map((candidate) => (
                        <CandidateCard
                          key={candidate.data.id}
                          candidate={candidate}
                        />
                      ))
                  )}
                </Flex>
              </ScrollArea>
              <DialogClose>
                <Button style={{ cursor: "pointer" }} variant="soft" mt="4">
                  Close
                </Button>
              </DialogClose>
            </DialogContent>
          </DialogRoot>
        )}
      </Card>
    </ScrollArea>
  );
}
