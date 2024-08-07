"use client";

import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { api as serverApi } from "@/trpc/server";
import {
  Text,
  Button,
  DialogTrigger,
  DialogContent,
  DialogRoot,
  Card,
  Progress,
  ScrollArea,
} from "frosted-ui";
import { Building, Loader } from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function OutboundDialog() {
  return (
    <>
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger disabled asChild>
            <Button
              disabled
              style={{ cursor: "pointer", padding: "2rem" }}
              size={"4"}
              variant="surface"
            >
              <div className="items-center flex flex-row gap-2">
                <Building className="size-10" />
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search Companies</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
