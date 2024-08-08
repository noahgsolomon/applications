"use client";

import { useState } from "react";
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
} from "frosted-ui";
import { Building, Building2, Check, Loader, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function CompanyDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [nearBrooklyn, setNearBrooklyn] = useState(false);
  const [searchInternet, setSearchInternet] = useState(false);

  const handleToggle = (type: "nearBrooklyn" | "searchInternet") => {
    if (type === "nearBrooklyn") {
      setNearBrooklyn((prev) => !prev);
    } else if (type === "searchInternet") {
      setSearchInternet((prev) => !prev);
    }
  };

  const handleSearch = () => {
    if (!query) {
      setError("Search query cannot be empty.");
      return;
    }
    setLoading(true);

    setError("");
    // outboundMutation.mutate({ query, job, nearBrooklyn });
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
                    <Building className="size-10" />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search Company</TooltipContent>
            </Tooltip>
          </DialogTrigger>
          <DialogContent
            size="3"
            style={{
              maxWidth: 450,
            }}
          >
            <DialogTitle>Company Search</DialogTitle>
            <DialogDescription>
              Enter the details for the company search.
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

                <div className="pt-2 flex flex-wrap gap-1">
                  <Avatar
                    color="blue"
                    size="2"
                    fallback="N"
                    src="https://media.licdn.com/dms/image/C4E0BAQEVb0ZISWk8vQ/company-logo_400_400/0/1631355051964?e=1730937600&v=beta&t=BePiAlZnY1phVclmSoD4TXS1Q5feMQQ5hC4iuA9Lbg0"
                  />

                  <Badge variant="surface" color="gray" className="h-[33px]">
                    <Building2 className="size-4" />
                    <Text>Software Engineer</Text>
                  </Badge>
                  <Button
                    style={{ cursor: "pointer" }}
                    disabled
                    className={`h-[33px]`}
                    variant="surface"
                    color={searchInternet ? "green" : "red"}
                    onClick={() => handleToggle("searchInternet")}
                  >
                    {searchInternet ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <X className="size-4 text-red-500/40" />
                    )}
                    <Text>Search Internet</Text>
                  </Button>
                  <Button
                    style={{ cursor: "pointer" }}
                    className={`h-[33px]`}
                    variant="surface"
                    color={nearBrooklyn ? "green" : "red"}
                    onClick={() => handleToggle("nearBrooklyn")}
                  >
                    {nearBrooklyn ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <X className="size-4 text-red-500/40" />
                    )}
                    <Text>Near Brooklyn</Text>
                  </Button>
                </div>
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
                onClick={handleSearch}
              >
                {loading ? (
                  <Loader className="size-4 animate-spin" />
                ) : (
                  "Filter"
                )}
              </Button>
            </Flex>
          </DialogContent>
        </DialogRoot>
      </TooltipProvider>
    </>
  );
}
