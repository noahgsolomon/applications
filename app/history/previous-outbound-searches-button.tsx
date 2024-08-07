import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "frosted-ui";
import { History } from "lucide-react";
import Link from "next/link";

export default function PreviousOutboundSearchesButton() {
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={"/history"}>
            <Button
              style={{ cursor: "pointer", padding: "2rem" }}
              size={"4"}
              variant="surface"
            >
              <div className="items-center flex flex-row gap-2">
                <History className="size-10" />
              </div>
            </Button>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Previous Searches</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
