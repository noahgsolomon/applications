"use client";

import { useEffect, useState } from "react";
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
} from "frosted-ui";
import {
  Building,
  Building2,
  Check,
  Loader,
  Pickaxe,
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
import { api as ServerApi } from "@/trpc/server";
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
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [nearBrooklyn, setNearBrooklyn] = useState(true);
  const [searchInternet, setSearchInternet] = useState(false);
  const [allMatchingSkills, setAllMatchingSkills] = useState<string[]>([]);
  const [candidateMatches, setCandidateMatches] = useState<
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

  return (
    <>
      <TooltipProvider delayDuration={500}>
        <DialogRoot open={open} onOpenChange={setOpen}>
          <DialogTrigger>
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
                        // onClick={() => {
                        //   if (filters) {
                        //     setFilters(
                        //       //@ts-ignore
                        //       (prev: CompanyFilterReturnType | null) => {
                        //         if (prev) {
                        //           return {
                        //             ...prev,
                        //             Or: !prev.Or,
                        //           };
                        //         } else {
                        //           return {
                        //             valid: false,
                        //             message: "",
                        //             companies: [],
                        //             relevantRole: undefined,
                        //             job: "",
                        //             skills: [],
                        //             Or: true,
                        //             query: undefined,
                        //           };
                        //         }
                        //       },
                        //     );
                        //   }
                        // }}
                        variant="surface"
                        color={filters.Or ? "yellow" : "red"}
                        // style={{ cursor: "pointer" }}
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

              {error && (
                <Text as="div" size="2" color="red">
                  {error}
                </Text>
              )}
            </Flex>
            <Flex gap="3" justify="end" mt="4">
              <DialogClose>
                <Button color="gray" variant="soft">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={loading}
                variant="classic"
                onClick={() => {
                  if (
                    filters?.valid &&
                    filters.companies.length > 0 &&
                    query === filters.query
                  ) {
                    handleSearch();
                  } else {
                    handleFilter();
                  }
                }}
              >
                {loading ? (
                  <Loader className="size-4 animate-spin" />
                ) : filters?.valid &&
                  filters.companies.length > 0 &&
                  query === filters.query ? (
                  "Search"
                ) : (
                  "Filter"
                )}
              </Button>
            </Flex>
            {candidateMatches && (
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
                  <ScrollArea className="py-4">
                    <Flex className="py-2" direction="column" gap="2">
                      {candidateMatches.length === 0
                        ? "No matches 😲"
                        : candidateMatches.map((candidate) => (
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
      </TooltipProvider>
    </>
  );
}
