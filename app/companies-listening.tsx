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
} from "frosted-ui";
import { HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function ListeningCompanies() {
  const [open, setOpen] = useState(false);
  const allActiveCompanies = api.outbound.allActiveCompanies.useQuery().data;
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
                  <HeartHandshake className="size-10" />
                </div>
              </Button>
            </TooltipTrigger>
            <TooltipContent>List of Scraped Companies</TooltipContent>
          </Tooltip>
        </DialogTrigger>
        <DialogContent>
          <ScrollArea className="flex flex-row gap-2">
            <Flex direction={"row"} wrap={"wrap"} gap={"4"}>
              {allActiveCompanies?.map((company) => (
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
              ))}
            </Flex>
          </ScrollArea>
        </DialogContent>
      </DialogRoot>
    </TooltipProvider>
  );
}
