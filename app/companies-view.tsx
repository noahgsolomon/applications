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
  Flex,
  ScrollArea,
  TextFieldInput,
  Text,
  Separator,
} from "frosted-ui";
import { Info, Loader, X } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useScrapedDialogStore } from "./store/filter-store";
import { motion } from "framer-motion";

export default function CompaniesView() {
  const {
    setOpen: setScrapedOpen,
    filters: scrapedFilters,
    setFilters: setScrapedFilters,
  } = useScrapedDialogStore();
  const [open, setOpen] = useState(false);
  const allActiveCompanies = api.outbound.allActiveCompanies.useQuery().data;
  const [filters, setFilters] = useState<string[]>([]);
  const [companies, setCompanies] = useState(
    scrapedFilters?.companies || allActiveCompanies || [],
  );
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // New state for edit mode
  const [isEditMode, setIsEditMode] = useState(false);

  // State to keep track of press and hold
  const [holdTimer, setHoldTimer] = useState<NodeJS.Timeout | null>(null);

  // State to manage removed companies
  const [removedCompanies, setRemovedCompanies] = useState<string[]>([]);

  const relevantCompaniesMutation =
    api.outbound.findRelevantCompanies.useMutation({
      onSuccess: (data) => {
        setCompanies(data.companies);
        setScrapedFilters({
          ...scrapedFilters,
          //@ts-ignore
          companies: data.companies,
        });
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

  const searchForCandidates = () => {
    setScrapedFilters({
      valid: true,
      message: "Filters applied",
      //@ts-ignore
      companies: companies,
      relevantRole: undefined,
      job: "",
      skills: [],
      Or: false,
      query: searchQuery,
    });
    setOpen(false);
    setScrapedOpen(true);
  };

  // Function to handle press and hold on avatars
  const handlePressIn = () => {
    const timer = setTimeout(() => {
      setIsEditMode(true);
    }, 1500); // 1.5 seconds
    setHoldTimer(timer);
  };

  const handlePressOut = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      setHoldTimer(null);
    }
  };

  // Function to exit edit mode
  const exitEditMode = () => {
    setIsEditMode(false);
  };

  // Function to remove a company
  const removeCompany = (companyId: string) => {
    // Update the list of companies by filtering out the removed company
    const updatedCompanies = companies.filter(
      (company) => company.id !== companyId,
    );
    setCompanies(updatedCompanies);

    // Update scrapedFilters
    setScrapedFilters({
      ...scrapedFilters,
      //@ts-ignore
      companies: updatedCompanies,
    });
  };

  return (
    <>
      <div className="w-full pb-4 flex flex-col gap-2">
        <Text as="div" mb="1" size="6" weight="bold">
          Company Search
        </Text>
        <Text className="text-primary/60 text-sm">
          Provide details to search for companies.
        </Text>
        <Separator />
        <div className="w-full flex flex-col gap-2">
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
                  Enter tech or features central to the company you are looking
                  for.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Flex>
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
          <div className="flex flex-row gap-2 items-center">
            <Button
              disabled={loading}
              variant="classic"
              style={{ cursor: "pointer", width: "fit-content" }}
              onClick={search}
            >
              {loading ? <Loader className="size-4 animate-spin" /> : "Search"}
            </Button>

            {isEditMode && (
              <Button
                variant="classic"
                color="red"
                onClick={exitEditMode}
                style={{ cursor: "pointer" }}
              >
                Exit Edit Mode
              </Button>
            )}
            {filters.map((filter) => (
              <Button
                color="sky"
                variant="surface"
                key={filter}
                style={{ cursor: "pointer" }}
              >
                {filter}
              </Button>
            ))}
            {(filters.length > 0 ||
              (scrapedFilters?.companies &&
                scrapedFilters.companies.length > 0 &&
                scrapedFilters?.companies.length! <
                  (allActiveCompanies?.length ?? 0))) && (
              <Button
                variant="surface"
                color="gray"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setFilters([]);
                  setScrapedFilters({
                    ...scrapedFilters,
                    //@ts-ignore
                    companies: allActiveCompanies,
                  });
                  setCompanies(allActiveCompanies || []);
                }}
              >
                <X className="size-4" />
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="flex flex-row gap-2">
        <Flex direction={"row"} wrap={"wrap"} gap={"4"}>
          {companies?.map((company) => (
            <TooltipProvider key={company.id} delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    // Apply vibration effect and overlay if in edit mode
                    animate={
                      isEditMode
                        ? {
                            rotate: [0, -2, 2, -2, 2, 0],
                            transition: {
                              repeat: Infinity,
                              duration: 0.8,
                            },
                          }
                        : {}
                    }
                    style={{
                      position: "relative",
                      cursor: "pointer",
                    }}
                    // Handle press and hold events
                    onMouseDown={handlePressIn}
                    onMouseUp={handlePressOut}
                    onMouseLeave={handlePressOut}
                    onTouchStart={handlePressIn}
                    onTouchEnd={handlePressOut}
                  >
                    {isEditMode ? (
                      // In edit mode, remove the link
                      <motion.div
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => removeCompany(company.id)}
                        whileHover={{ scale: 1.05 }}
                      >
                        <Avatar
                          className={`shadow-md transition-all`}
                          color="blue"
                          size="5"
                          fallback={company.name.charAt(0).toUpperCase()}
                          src={company.logo ?? ""}
                        />
                        {/* X icon overlay on hover */}
                        <motion.div
                          whileHover={{ opacity: 1 }}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(255, 0, 0, 0.3)",
                            borderRadius: "10%",
                            opacity: 0, // Start hidden
                          }}
                        >
                          <X className="size-6 text-white" />
                        </motion.div>
                      </motion.div>
                    ) : (
                      // In normal mode, show the link
                      <Link target="_blank" href={company.linkedinUrl}>
                        <Avatar
                          className={`shadow-md hover:scale-[101%] active:scale-[99%] transition-all cursor-pointer`}
                          color="blue"
                          size="5"
                          fallback={company.name.charAt(0).toUpperCase()}
                          src={company.logo ?? ""}
                        />
                      </Link>
                    )}
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent>{company.name}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </Flex>
      </ScrollArea>
    </>
  );
}
