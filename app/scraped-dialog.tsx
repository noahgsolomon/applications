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
} from "frosted-ui";
import {
  Building2,
  Check,
  Loader,
  Upload,
  UserRoundSearch,
  X,
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
} from "@/server/db/schemas/users/schema";
import {
  CompanyFilterReturnType,
  useScrapedDialogStore,
} from "./store/filter-store";

const toPascalCase = (str: string) => {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

export default function ScrapedDialog() {
  const { open, setOpen, filters, setFilters } = useScrapedDialogStore();
  const [loadingCount, setLoadingCount] = useState(0);
  const loading = loadingCount > 0;
  const [sorting, setSorting] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [profileUrls, setProfileUrls] = useState<string[]>([]);
  const [matchedGithubUrls, setMatchedGithubUrls] = useState<string[]>([]);

  const [profileType, setProfileType] = useState<"linkedin" | "github">(
    "linkedin",
  );

  const [nearBrooklyn, setNearBrooklyn] = useState(true);
  const [searchInternet, setSearchInternet] = useState(false);
  const [allMatchingSkills, setAllMatchingSkills] = useState<string[]>([]);
  const [cookdSorting, setCookdSorting] = useState(true);
  const [candidateMatches, setCandidateMatches] = useState<
    | (InferSelectModel<typeof candidates> & {
        company?: InferSelectModel<typeof companyTable> | null;
      })[]
    | null
  >(null);

  const [sortedCandidateMatches, setSortedCandidateMatches] = useState<
    | (InferSelectModel<typeof candidates> & {
        company?: InferSelectModel<typeof companyTable> | null;
      })[]
    | null
  >(null);

  const getPendingSimilarProfilesQuery =
    api.outbound.getPendingSimilarProfiles.useQuery(undefined, {
      refetchInterval: 5000,
    });

  useEffect(() => {
    if (cookdSorting) {
      setCookdSorting(false);
    }
    console.log("here it is" + getPendingSimilarProfilesQuery.data);
    if (
      getPendingSimilarProfilesQuery.data &&
      getPendingSimilarProfilesQuery.data[0]
    ) {
      setLoadingCount((prev) => prev + 1);
    }
    if (
      getPendingSimilarProfilesQuery.data &&
      getPendingSimilarProfilesQuery.data[0] &&
      getPendingSimilarProfilesQuery.data[0]?.error
    ) {
      toast.error("Internal Server Error");

      deletePendingSimilarProfilesMutation.mutate({
        id: getPendingSimilarProfilesQuery.data[0].id,
      });

      setLoadingCount((prev) => prev - 1);
    } else if (
      getPendingSimilarProfilesQuery.data &&
      getPendingSimilarProfilesQuery.data[0] &&
      getPendingSimilarProfilesQuery.data[0]?.success
    ) {
      toast.success("Search completed!");

      setCandidateMatches(getPendingSimilarProfilesQuery.data[0].response);
      setLoadingCount((prev) => prev - 1);

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
      onSuccess: (data) => {},
      onError: () => {},
    });

  const insertIntoQueueMutation = api.outbound.insertIntoQueue.useMutation({
    onSuccess: (data) => {
      setLoadingCount((prev) => prev - 1);
      if (data?.success) {
        toast.success("Message sent successfully");
      } else {
        console.error("Error sending message:", error);
        toast.error("Failed to send message");
      }
    },
    onError: (error) => {
      setLoadingCount((prev) => prev - 1);
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
    },
  });

  const findFilteredCandidatesMutation =
    api.outbound.findFilteredCandidates.useMutation({
      onSuccess: (data) => {
        console.log(data);
        setCandidateMatches(data.candidates);
        setAllMatchingSkills(data.skills.map((s) => s.technology));
        setLoadingCount((prev) => prev - 1);
        toast.success("outbound search completed");
      },
      onError: () => {
        setOpen(false);
        setLoadingCount((prev) => prev - 1);
        toast.error("Internal server error");
      },
    });

  const pollCookdScoringRequestQuery =
    api.outbound.pollCookdScoringRequest.useQuery(
      { ids: candidateMatches?.map((c) => c.id) ?? [] },
      {
        enabled: sorting,
        refetchInterval: 10000,
      },
    );

  useEffect(() => {
    if (pollCookdScoringRequestQuery.data) {
      console.log("poll query", pollCookdScoringRequestQuery.data.length);
      const data = pollCookdScoringRequestQuery.data;
      setSortedCandidateMatches(data);
      if (data.length >= (candidateMatches?.length ?? 0) - 1) {
        setSorting(false);
        setCandidateMatches(data);
        setSortedCandidateMatches(null);
      }
    }
  }, [pollCookdScoringRequestQuery.data, candidateMatches]);

  const handleToggle = (type: "nearBrooklyn" | "searchInternet") => {
    if (type === "nearBrooklyn") {
      setNearBrooklyn((prev) => !prev);
    } else if (type === "searchInternet") {
      setSearchInternet((prev) => !prev);
    }
  };

  const companyFilterMutation = api.outbound.companyFilter.useMutation({
    onSuccess: (data: CompanyFilterReturnType) => {
      setLoadingCount((prev) => prev - 1);
      if (!data.valid) {
        setError(data.message);
      }
      if ((filters?.companies.length ?? 0) > 0) {
        setFilters({
          ...data,
          //@ts-ignore
          companies: filters?.companies,
        });
      } else {
        setFilters(data);
      }
    },
    onError: () => {
      setLoadingCount((prev) => prev - 1);
    },
  });

  const handleFilter = () => {
    if (!query) {
      setError("Search query cannot be empty.");
      return;
    }
    setLoadingCount((prev) => prev + 1);

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
  ): { type: "linkedin" | "github"; urls: string[] } => {
    const linkedinRegex =
      /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-%.]+/g;
    const githubRegex = /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9-]+/g;

    const linkedinMatches = content.match(linkedinRegex) || [];
    const githubMatches = content.match(githubRegex) || [];

    if (linkedinMatches.length > 0) {
      return {
        type: "linkedin",
        urls: [...new Set(linkedinMatches)].map(normalizeUrl),
      };
    } else if (githubMatches.length > 0) {
      return {
        type: "github",
        urls: [...new Set(githubMatches)].map(normalizeUrl),
      };
    }

    return { type: "linkedin", urls: [] };
  };
  const handleManualUrlsChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setManualUrls(e.target.value);
    const { type, urls } = extractUrls(e.target.value);
    setProfileType(type);
    setProfileUrls(urls);
  };

  const handleFileProcessing = async (file: File) => {
    setError("");
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const { type, urls } = extractUrls(content);
      if (urls.length > 0) {
        setProfileType(type);
        setProfileUrls(urls);
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

  const handleSearch = () => {
    setLoadingCount((prev) => prev + 1);

    setError("");
    findFilteredCandidatesMutation.mutate({
      query,
      searchInternet: false,
      relevantRoleId: undefined,
      companyIds: filters?.companies.map((company) => company.id) ?? [],
      job: filters?.job,
      skills: filters?.skills,
      booleanSearch: "",
      nearBrooklyn,
    });
  };

  const handleSort = () => {
    const unreviewedCandidates =
      candidateMatches?.filter((c) => !c.cookdReviewed) ?? [];
    if (
      candidateMatches &&
      candidateMatches.length > unreviewedCandidates.length &&
      !sorting
    ) {
      setSorting(true);
      setSortedCandidateMatches(
        candidateMatches?.filter((c) => c.cookdReviewed),
      );
      // actually wait we optimistically do this in the filtered candidates endpoint
      // sendCookdScoringRequestMutation.mutate({
      //   ids: unreviewedCandidates.map((c) => c.id),
      // });
    }
  };

  const findSimilarProfiles = async (profileUrls: string[]) => {
    setError("");

    const payload =
      profileType === "linkedin"
        ? { profileUrls }
        : { githubUrls: profileUrls };

    insertIntoQueueMutation.mutate({
      payload,
      profileType,
    });
    getPendingSimilarProfilesQuery.refetch();
  };

  const handleProfileSearch = () => {
    if (profileUrls.length === 0) {
      setError("No LinkedIn or GitHub URLs loaded.");
      return;
    }
    setError("");
    setLoadingCount((prev) => prev + 1);
    findSimilarProfiles(profileUrls);
  };

  return (
    <>
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogTrigger>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  style={{ cursor: "pointer", padding: "2rem" }}
                  size={"4"}
                  onClick={() => setOpen(true)}
                  variant="surface"
                >
                  <div className="items-center flex flex-row gap-2">
                    <UserRoundSearch className="size-10" />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search for Candidates</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DialogTrigger>
        <DialogContent
          size="3"
          style={{
            maxWidth: 450,
          }}
        >
          <DialogTitle>Candidate search</DialogTitle>
          <DialogDescription>
            Enter the details for the candidate search.
          </DialogDescription>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" mb="1" size="2" weight="bold">
                Search Query
              </Text>
              <TextFieldInput
                placeholder="Enter search query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {filters && filters.valid && filters.companies.length > 0 && (
                <div className="pt-2 flex flex-wrap gap-1">
                  {filters.companies.map((company) => (
                    <Avatar
                      key={company.id}
                      color="blue"
                      size="2"
                      fallback={company.name.charAt(0).toUpperCase()}
                      src={company.logo ?? ""}
                    />
                  ))}
                  {filters.job !== "" && (
                    <Badge variant="surface" color="amber" className="h-[33px]">
                      <Building2 className="size-4" />
                      <Text>{toPascalCase(filters.job)}</Text>
                    </Badge>
                  )}
                  {filters.skills.map((skill: string) => (
                    <Badge
                      key={skill}
                      variant="surface"
                      color="blue"
                      className="h-[33px]"
                    >
                      <Text>{toPascalCase(skill)}</Text>
                    </Badge>
                  ))}
                  {/* {filters.skills.length > 0 && ( */}
                  {/*   <Badge */}
                  {/*     variant="surface" */}
                  {/*     color={filters.Or ? "yellow" : "red"} */}
                  {/*     className="h-[33px]" */}
                  {/*   > */}
                  {/*     <Text>{filters.Or ? "OR" : "AND"}</Text> */}
                  {/*   </Badge> */}
                  {/* )} */}

                  <Badge
                    style={{ cursor: "pointer" }}
                    className={`h-[33px]`}
                    variant="surface"
                    color={nearBrooklyn ? "green" : "red"}
                    onClick={() => handleToggle("nearBrooklyn")}
                  >
                    {nearBrooklyn ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <X className="size-4 text-red-500" />
                    )}
                    <Text>Near Brooklyn</Text>
                  </Badge>

                  <Badge
                    style={{ cursor: "pointer" }}
                    className={`h-[33px]`}
                    variant="surface"
                    color={"gray"}
                    onClick={() => setFilters(null)}
                  >
                    <Text>Clear Filters</Text>
                  </Badge>
                </div>
              )}
            </label>
            <Text as="div" mb="1" size="2" weight="bold">
              Enter LinkedIn or GitHub URLs (not both)
            </Text>
            <TextArea
              placeholder="Paste LinkedIn URLs here (one per line)"
              value={manualUrls}
              onChange={handleManualUrlsChange}
              style={{ minHeight: "100px" }}
            />
            <Text
              as="div"
              mb="1"
              size="2"
              weight="bold"
              style={{ marginTop: "1rem" }}
            >
              Or Upload File
            </Text>
            <div
              className={`border-dashed p-4 py-6 bg-secondary cursor-pointer rounded-lg border-2 transition-all duration-300 ease-in-out
                      flex flex-col gap-2 items-center justify-center opacity-60`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-6" />
              <p className={`text-sm text-center`}>
                {
                  "Drag and drop your file here (.txt, .csv)\nor click to upload"
                }
              </p>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".txt,.csv"
                style={{ display: "none" }}
              />
            </div>
            {error && (
              <Text as="div" size="2" color="red" style={{ marginTop: "10px" }}>
                {error}
              </Text>
            )}
            {profileUrls.length > 0 && (
              <div className="mt-4">
                <Text as="div" size="2" style={{ marginBottom: "10px" }}>
                  {profileUrls.length} unique{" "}
                  {profileType === "linkedin" ? "LinkedIn" : "GitHub"} URLs
                  loaded
                </Text>
                <div className="flex flex-wrap gap-2">
                  {profileUrls.map((url, index) => (
                    <Badge
                      key={index}
                      variant="surface"
                      color={profileType === "linkedin" ? "blue" : "green"}
                    >
                      {url.split("/").pop()}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Flex>
          <Flex gap="3" justify="end" mt="4">
            <DialogClose>
              <Button color="gray" variant="soft">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={
                loading ||
                (query.trim() === "" && profileUrls.length === 0 && !filters)
              }
              variant="classic"
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
                if (query || filters || profileUrls.length > 0) {
                  if (filters) {
                    handleSearch();
                  } else if (profileUrls.length > 0) {
                    handleProfileSearch();
                  } else if (query) {
                    handleFilter();
                  }
                }
              }}
            >
              {loading ? (
                <Loader className="size-4 animate-spin" />
              ) : filters || profileUrls.length > 0 ? (
                "Search"
              ) : (
                "Filter"
              )}
            </Button>
          </Flex>
          {(candidateMatches || sorting || matchedGithubUrls.length > 0) && (
            <DialogRoot>
              <DialogTrigger>
                <Button
                  style={{ margin: "1rem 0", cursor: "pointer" }}
                  variant="classic"
                >
                  View Candidates
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Candidates</DialogTitle>
                <DialogDescription className="font-bold text-2xl italic">
                  List of candidates sorted by weight.
                </DialogDescription>
                {candidateMatches ? (
                  <>
                    {candidateMatches.filter((c) => c.cookdReviewed).length <
                      candidateMatches.length - 1 && cookdSorting ? (
                      <Button
                        onClick={handleSort}
                        disabled={sorting || true} // disabled indefinitely right now because waiting on custom signals
                        variant="classic"
                        style={{ cursor: "pointer" }}
                      >
                        {sorting ? (
                          <Loader className="size-4 animate-spin" />
                        ) : (
                          "Sort (disabled rn)"
                        )}
                      </Button>
                    ) : null}
                  </>
                ) : matchedGithubUrls ? (
                  <div className="flex flex-col gap-2 ">
                    {matchedGithubUrls.map((url) => (
                      <Link href={url} target="_blank" key={url}>
                        {url}
                      </Link>
                    ))}
                  </div>
                ) : null}
                {sorting && (
                  <Text
                    as="div"
                    size="2"
                    color="blue"
                    style={{ marginTop: "0.5rem" }}
                  >
                    Sorting candidates based on relevance. this will take a
                    couple minutes...
                  </Text>
                )}
                <ScrollArea className="py-4">
                  <Flex className="py-2" direction="column" gap="2">
                    {candidateMatches?.length === 0
                      ? "No matches 😲"
                      : (sorting
                          ? sortedCandidateMatches ?? []
                          : candidateMatches
                        )
                          ?.sort((a, b) =>
                            cookdSorting
                              ? (b.cookdScore ?? 0) - (a.cookdScore ?? 0)
                              : 0,
                          )
                          .map((candidate) => (
                            <CandidateCard
                              key={candidate.id}
                              candidate={candidate!}
                              allMatchingSkills={allMatchingSkills}
                              company={candidate.company!}
                            />
                          ))}
                  </Flex>
                </ScrollArea>
                <DialogClose>
                  <Button variant="classic">Close</Button>
                </DialogClose>
              </DialogContent>
            </DialogRoot>
          )}
        </DialogContent>
      </DialogRoot>
    </>
  );
}
