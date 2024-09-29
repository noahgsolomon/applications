"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button, DialogContent, DialogRoot, DialogTrigger } from "frosted-ui";
import { Building } from "lucide-react";
import { useState } from "react";
import CompaniesView from "./companies-view";

export default function ListeningCompanies() {
  const [open, setOpen] = useState(false);

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
                color="gray"
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
          <CompaniesView />
        </DialogContent>
      </DialogRoot>
    </TooltipProvider>
  );
}
