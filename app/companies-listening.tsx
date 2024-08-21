"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import {
  Avatar,
  Button,
  DialogContent,
  DialogRoot,
  DialogTrigger,
  Flex,
  ScrollArea,
  TextFieldInput,
  Text,
  Badge,
} from "frosted-ui";
import { Building, Loader, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function ListeningCompanies() {
  const [open, setOpen] = useState(false);
  const allActiveCompanies = api.outbound.allActiveCompanies.useQuery().data;
  const [filters, setFilters] = useState<string[]>([]);
  const [companies, setCompanies] = useState(allActiveCompanies);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const relevantCompaniesMutation =
    api.outbound.findRelevantCompanies.useMutation({
      onSuccess: (data) => {
        setCompanies(data.companies);
        setFilters(data.filters);
        setSearchQuery("");
      },
    });

  const search = async () => {
    if (!searchQuery) {
      setError("Search query cannot be empty.");
      return;
    }
    setError(null);
    setLoading(true);
    await relevantCompaniesMutation.mutateAsync({ query: searchQuery });
    setLoading(false);
  };

  return (
    <TooltipProvider delayDuration={500}>
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => setOpen(true)}
                style={{ cursor: "pointer", padding: "2rem" }}
                size={"4"}
                variant="surface"
              >
                <div className="items-center flex flex-row gap-2">
                  <Building className="size-10" />
                </div>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search for Companies</TooltipContent>
          </Tooltip>
        </DialogTrigger>
        <DialogContent>
          <div className="w-full pb-4 flex flex-col gap-2">
            <Text as="div" mb="1" size="2" weight="bold">
              Find Company by Tech Stack or Feature
            </Text>
            <div className="w-full flex flex-col gap-2">
              <TextFieldInput
                placeholder="Enter search query"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {error && (
                <Text as="div" size="2" color="red">
                  {error}
                </Text>
              )}
              <Button
                disabled={loading}
                variant="classic"
                style={{ cursor: "pointer", width: "fit-content" }}
                onClick={search}
              >
                {loading ? (
                  <Loader className="size-4 animate-spin" />
                ) : (
                  "Search"
                )}
              </Button>
            </div>{" "}
            <div className="flex flex-wrap gap-1">
              {filters.map((filter) => (
                <Badge variant="surface" key={filter}>
                  {filter}
                </Badge>
              ))}
              {filters.length > 0 && (
                <Badge
                  variant="surface"
                  color="gray"
                  style={{ cursor: "pointer" }}
                  onClick={() => setFilters([])}
                >
                  <X className="size-4" />
                  Clear filters
                </Badge>
              )}
            </div>
          </div>

          <ScrollArea className="flex flex-row gap-2">
            <Flex direction={"row"} wrap={"wrap"} gap={"4"}>
              {(filters.length > 0 ? companies : allActiveCompanies)?.map(
                (company) => (
                  <TooltipProvider key={company.id} delayDuration={500}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link target="_blank" href={company.linkedinUrl}>
                          <Avatar
                            className="cursor-pointer shadow-md hover:scale-[101%] active:scale-[99%] transition-all"
                            color="blue"
                            size="5"
                            fallback={company.name.charAt(0).toUpperCase()}
                            src={company.logo ?? ""}
                          />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>{company.name}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ),
              )}
            </Flex>
          </ScrollArea>
        </DialogContent>
      </DialogRoot>
    </TooltipProvider>
  );
}
