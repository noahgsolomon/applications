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
import WhopLogo from "./WhopLogo";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface ProfileUrl {
  type: "linkedin" | "github";
  mode: "MANUAL" | "UPLOAD";
  url: string;
}

const toPascalCase = (str: string) => {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

export default function ScrapedDialog() {
  const { open, setOpen, filters, setFilters } = useScrapedDialogStore();
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [profileUrls, setProfileUrls] = useState<ProfileUrl[]>([]);
  const [matchedGithubUrls, setMatchedGithubUrls] = useState<string[]>([]);

  const allActiveCompanies = api.outbound.allActiveCompanies.useQuery().data;

  const [nearBrooklyn, setNearBrooklyn] = useState(true);
  const [searchInternet, setSearchInternet] = useState(false);
  const [activeGithub, setActiveGithub] = useState(false);
  const [whopUser, setWhopUser] = useState(false);
  const [bigTech, setBigTech] = useState(false);
  const [cookdSorting, setCookdSorting] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [candidateMatches, setCandidateMatches] = useState<
    | {
        data: InferSelectModel<typeof people>;
        score: number;
        matchedSkills?: { score: number; skill: string }[];
        matchedJobTitle?: { score: number; jobTitle: string };
        matchedLocation?: { score: number; location: string };
      }[]
    | null
  >(null);

  const getPendingSimilarProfilesQuery =
    api.outbound.getPendingSimilarProfiles.useQuery(undefined, {
      refetchInterval: 2500,
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
          | null,
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

  // This mutation is no longer needed since we're handling everything via the queue
  // const findFilteredCandidatesMutation = ...

  const handleToggle = (
    type:
      | "bigTech"
      | "nearBrooklyn"
      | "searchInternet"
      | "activeGithub"
      | "whopUser",
  ) => {
    if (type === "nearBrooklyn") {
      setNearBrooklyn((prev) => !prev);
    } else if (type === "searchInternet") {
      setSearchInternet((prev) => !prev);
    } else if (type === "activeGithub") {
      setActiveGithub((prev) => !prev);
    } else if (type === "whopUser") {
      setWhopUser((prev) => !prev);
    } else if (type === "bigTech") {
      setBigTech((prev) => !prev);
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
      searchInternet,
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
    content: string,
  ): { linkedinUrls: string[]; githubUrls: string[] } => {
    const linkedinRegex =
      /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-%.]+/g;
    const githubRegex = /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9-]+/g;

    const linkedinMatches = content.match(linkedinRegex) || [];
    const githubMatches = content.match(githubRegex) || [];

    return {
      linkedinUrls: [...new Set(linkedinMatches)].map(normalizeUrl),
      githubUrls: [...new Set(githubMatches)].map(normalizeUrl),
    };
  };

  const handleManualUrlsChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setManualUrls(e.target.value);
    const { linkedinUrls, githubUrls } = extractUrls(e.target.value);

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
          self.findIndex((t) => t.url === url.url && t.type === url.type),
      ),
    );
  };

  const handleFileProcessing = async (file: File) => {
    setError("");
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const { linkedinUrls, githubUrls } = extractUrls(content);
      if (linkedinUrls.length > 0 || githubUrls.length > 0) {
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
              self.findIndex((t) => t.url === url.url && t.type === url.type),
          ),
        );
      } else {
        setError("No valid LinkedIn or GitHub URLs found in the file.");
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

    if (filters) {
      payload.filterCriteria = {
        query,
        searchInternet: false,
        relevantRoleId: undefined,
        companyIds:
          (filters?.companies ?? []).map((company) => company.id) ?? [],
        job: filters?.job ?? "",
        skills: filters?.skills ?? [],
        booleanSearch: "",
        nearBrooklyn,
        location: filters?.location,
        activeGithub: activeGithub,
        whopUser: whopUser,
        bigTech: bigTech,
        school: filters?.school ?? "",
        fieldOfStudy: filters?.fieldOfStudy ?? "",
      };
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
    setError("");
    setLoading(true);
    findSimilarProfiles(profileUrls);
  };

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
              disabled={loading}
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
                      Companies List
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
                          word.charAt(0).toUpperCase() + word.slice(1),
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
                          (s: string) => s !== skill,
                        ),
                      })
                    }
                    color="sky"
                    key={skill}
                    variant="surface"
                  >
                    <Text>{toPascalCase(skill)}</Text>
                  </Button>
                ))}

              {filters && (
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
                  {filters.school ? (
                    <Button
                      variant="surface"
                      size="2"
                      style={{ cursor: "pointer" }}
                      color={"amber"}
                      className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                      onClick={() => {
                        setFilters({ ...filters, school: "" });
                      }}
                    >
                      <School className="size-4" />
                      {filters.school}
                    </Button>
                  ) : null}
                  {filters.fieldOfStudy ? (
                    <Button
                      variant="surface"
                      size="2"
                      style={{ cursor: "pointer" }}
                      color={"cyan"}
                      className="hover:line-through hover:text-red-500 transition duration-200 ease-in-out"
                      onClick={() => {
                        setFilters({ ...filters, fieldOfStudy: "" });
                      }}
                    >
                      <GraduationCap className="size-4" />
                      {filters.fieldOfStudy}
                    </Button>
                  ) : null}
                  <Button
                    variant="surface"
                    size="2"
                    style={{ cursor: "pointer" }}
                    color={activeGithub ? "green" : "red"}
                    onClick={() => handleToggle("activeGithub")}
                  >
                    {activeGithub ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <X className="size-4 text-red-500" />
                    )}
                    Active Github
                  </Button>
                  <Button
                    variant="surface"
                    size="2"
                    style={{ cursor: "pointer" }}
                    color={bigTech ? "green" : "red"}
                    onClick={() => handleToggle("bigTech")}
                  >
                    {bigTech ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <X className="size-4 text-red-500" />
                    )}
                    Big Tech
                  </Button>
                  <Button
                    variant="surface"
                    size="2"
                    style={{ cursor: "pointer" }}
                    color={whopUser ? "green" : "red"}
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
                    Whop User
                  </Button>
                  <Button
                    variant="surface"
                    color="gray"
                    style={{ cursor: "pointer" }}
                    onClick={() => setFilters(null)}
                  >
                    <X className="size-4" />
                    Clear filters
                  </Button>
                </>
              )}
            </Flex>
          </Flex>

          <Separator />

          {/* Profile URLs Section */}
          <Accordion type="single" collapsible>
            <AccordionItem value="urls">
              <AccordionTrigger>
                <Text size="2" weight="bold">
                  Upload Ideal LinkedIn or GitHub Candidate URLs
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
                {profileUrls.length > 0 && (
                  <Flex direction="column" gap="2" mt="2">
                    <Text size="2">
                      {profileUrls.length} unique LinkedIn and GitHub URLs
                      loaded
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
                              profileUrls.filter((u) => u !== urlObj),
                            );
                            setManualUrls(
                              manualUrls
                                .replace(urlObj.url, "")
                                .replace(
                                  urlObj.url.replace("https://", ""),
                                  "",
                                ),
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

                      <Button
                        variant="surface"
                        color="gray"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setProfileUrls([]);
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
                  Flush Queue
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
        {(candidateMatches || sorting || matchedGithubUrls.length > 0) && (
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
              <Separator />
              {sorting && (
                <Text size="2" color="blue" mt="2">
                  Sorting candidates based on relevance. This will take a few
                  minutes...
                </Text>
              )}
              <ScrollArea className="py-4">
                <Flex direction="column" gap="2">
                  {candidateMatches?.length === 0
                    ? "No matches found."
                    : candidateMatches
                        ?.sort((a, b) => b.score - a.score)
                        .map((candidate) => (
                          <CandidateCard
                            key={candidate.data.id}
                            bigTech={bigTech}
                            activeGithub={activeGithub}
                            whopUser={whopUser}
                            candidate={candidate!}
                            // company={candidate.company!}
                          />
                        ))}
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
