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
import * as pdfjs from "pdfjs-dist";

const toPascalCase = (str: string) => {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

export default function ScrapedDialog() {
  const { open, setOpen, filters, setFilters } = useScrapedDialogStore();
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [searchMode, setSearchMode] = useState<"query" | "profile">("query");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [profileUrls, setProfileUrls] = useState<string[]>([]);

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

  const findFilteredCandidatesMutation =
    api.outbound.findFilteredCandidates.useMutation({
      onSuccess: (data) => {
        console.log(data);
        setCandidateMatches(data.candidates);
        setAllMatchingSkills(data.skills.map((s) => s.technology));
        setLoading(false);
        toast.success("outbound search completed");
      },
      onError: () => {
        setOpen(false);
        setLoading(false);
        toast.error("Internal server error");
      },
    });

  // const sendCookdScoringRequestMutation =
  //   api.outbound.sendCookdScoringRequest.useMutation({});

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
      setLoading(false);
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
  });

  const handleFilter = () => {
    if (!query) {
      setError("Search query cannot be empty.");
      return;
    }
    setLoading(true);

    setError("");
    companyFilterMutation.mutate({
      query,
      searchInternet,
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [manualUrls, setManualUrls] = useState("");

  const extractLinkedInUrls = (content: string): string[] => {
    const regex = /https:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/g;
    const matches = content.match(regex);
    return matches ? [...new Set(matches)] : [];
  };

  const handleManualUrlsChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setManualUrls(e.target.value);
    const urls = extractLinkedInUrls(e.target.value);
    setProfileUrls(urls);
  };

  const handleFileProcessing = async (file: File) => {
    setError("");
    if (file.type === "application/pdf") {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        let content = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          content += textContent.items.map((item: any) => item.str).join(" ");
        }
        const urls = extractLinkedInUrls(content);
        setProfileUrls(urls);
        if (urls.length === 0) {
          setError("No valid LinkedIn URLs found in the PDF.");
        }
      } catch (error) {
        console.error("Error processing PDF:", error);
        setError("Error processing PDF file. Please try again.");
      }
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const urls = extractLinkedInUrls(content);
        if (urls.length > 0) {
          setProfileUrls(urls);
        } else {
          setError("No valid LinkedIn URLs found in the file.");
        }
      };
      reader.onerror = () => {
        setError("Error reading file. Please try again.");
      };
      reader.readAsText(file);
    }
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
    setLoading(true);

    setError("");
    findFilteredCandidatesMutation.mutate({
      query,
      searchInternet: false,
      relevantRoleId:
        // filters?.relevantRole?.id,
        undefined,
      companyIds: filters?.companies.map((company) => company.id) ?? [],
      job: filters?.job,
      skills: filters?.skills,
      booleanSearch: "",
      nearBrooklyn,
      Or: filters?.Or,
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
    setLoading(true);
    try {
      const response = await fetch("/api/find-similar-profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileUrls }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      console.log("Similar profiles found:", data);
      setCandidateMatches(data.similarProfiles);
      setCookdSorting(false);
      setLoading(false);
      toast.success("Similar profiles search completed");
    } catch (error) {
      setLoading(false);
      toast.error("Error finding similar profiles: " + error);
    }
  };

  const handleProfileSearch = () => {
    if (profileUrls.length === 0) {
      setError("No LinkedIn URLs loaded.");
      return;
    }
    setLoading(true);
    setError("");

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
            <Flex gap="3" justify="start" mt="4">
              <Button
                variant={searchMode === "query" ? "soft" : "surface"}
                color={searchMode === "query" ? "red" : "gray"}
                onClick={() => setSearchMode("query")}
              >
                Query Search
              </Button>
              <Button
                color={searchMode === "profile" ? "red" : "gray"}
                variant={searchMode === "profile" ? "soft" : "surface"}
                onClick={() => setSearchMode("profile")}
              >
                Profile Search
              </Button>
            </Flex>
            {searchMode === "query" ? (
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
                      <Badge
                        variant="surface"
                        color="amber"
                        className="h-[33px]"
                      >
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
                    {filters.skills.length > 0 && (
                      <Badge
                        variant="surface"
                        color={filters.Or ? "yellow" : "red"}
                        className="h-[33px]"
                      >
                        <Text>{filters.Or ? "OR" : "AND"}</Text>
                      </Badge>
                    )}

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
            ) : (
              <>
                <Text as="div" mb="1" size="2" weight="bold">
                  Enter LinkedIn URLs
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
                      "Drag and drop your file here (.txt, .csv, or .pdf)\nor click to upload"
                    }
                  </p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept=".txt,.csv,.pdf"
                    style={{ display: "none" }}
                  />
                </div>
                {error && (
                  <Text
                    as="div"
                    size="2"
                    color="red"
                    style={{ marginTop: "10px" }}
                  >
                    {error}
                  </Text>
                )}
                {profileUrls.length > 0 && (
                  <div className="mt-4">
                    <Text as="div" size="2" style={{ marginBottom: "10px" }}>
                      {profileUrls.length} unique LinkedIn URLs loaded
                    </Text>
                    <div className="flex flex-wrap gap-2">
                      {profileUrls.map((url, index) => (
                        <Badge key={index} variant="surface" color="blue">
                          {url.split("/").pop()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
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
                (searchMode === "profile" && profileUrls.length === 0)
              }
              variant="classic"
              onClick={() => {
                console.log(searchMode);
                if (searchMode === "query") {
                  if (
                    filters?.valid &&
                    filters.companies.length > 0 &&
                    query === filters.query
                  ) {
                    handleSearch();
                  } else {
                    handleFilter();
                  }
                } else {
                  handleProfileSearch();
                }
              }}
            >
              {loading ? (
                <Loader className="size-4 animate-spin" />
              ) : searchMode === "query" ? (
                filters?.valid &&
                filters.companies.length > 0 &&
                query === filters.query ? (
                  "Search"
                ) : (
                  "Filter"
                )
              ) : (
                "Find Similar Profiles"
              )}
            </Button>
          </Flex>
          {(candidateMatches || sorting) && (
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
                {candidateMatches &&
                  candidateMatches.filter((c) => c.cookdReviewed).length <
                    candidateMatches.length - 1 &&
                  cookdSorting && (
                    <Button
                      onClick={handleSort}
                      disabled={sorting}
                      variant="classic"
                      style={{ cursor: "pointer" }}
                    >
                      {sorting ? (
                        <Loader className="size-4 animate-spin" />
                      ) : (
                        "Sort"
                      )}
                    </Button>
                  )}
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
                          ? (sortedCandidateMatches ?? [])
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
