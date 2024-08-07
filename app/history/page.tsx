import { api } from "@/trpc/server";
import PreviousOutboundSearches from "./previous-outbound-searches";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button, Heading } from "frosted-ui";

export default async function Page() {
  const previousOutboundSearches = await api.outbound.searches();

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-12 min-h-[80vh] max-w-[95%] sm:max-w-[80%] mx-auto">
      <div className="flex gap-4 flex-row items-center pb-12">
        <Link href={"/"}>
          <Button style={{ cursor: "pointer" }}>
            <ChevronLeft className="size-4" />
          </Button>
        </Link>

        <Heading>Previous Outbound Searches</Heading>
      </div>
      <PreviousOutboundSearches
        previousOutboundSearches={previousOutboundSearches}
      />
    </div>
  );
}
