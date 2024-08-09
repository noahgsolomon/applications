"use client";

import {
  Text,
  Button,
  DialogTrigger,
  DialogContent,
  DialogRoot,
  Card,
  Progress,
  ScrollArea,
  Flex,
  Avatar,
} from "frosted-ui";
import { Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { api as ServerApi } from "@/trpc/server";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";

export default function PollingCompanyOutbound() {
  const [pollingData, setPollingData] = useState<
    Awaited<ReturnType<typeof ServerApi.outbound.pollPendingCompanyOutbound>>
  >([]);
  const pollPendingCompanyOutboundQuery =
    api.outbound.pollPendingCompanyOutbound.useMutation();

  const router = useRouter();

  const outboundSearchesQuery = api.outbound.searches.useQuery(undefined, {
    enabled: false,
  });

  const deletePendingCompanyOutboundMutation =
    api.outbound.deletePendingCompanyOutbound.useMutation({
      onSuccess: () => {},
    });

  useEffect(() => {
    const poll = async () => {
      try {
        const response = await pollPendingCompanyOutboundQuery.mutateAsync();
        setPollingData(response);

        if (
          response?.some(
            (item) => item.progress === 100 || item.status === "COMPLETED",
          )
        ) {
          toast.success("Company outbound search completed");

          outboundSearchesQuery.refetch();
          router.push("/history");

          const items = response?.filter(
            (item) => item.progress === 100 || item.status === "COMPLETED",
          );
          for (const item of items) {
            deletePendingCompanyOutboundMutation.mutate({
              id: item.id,
            });
          }
        }
      } catch (error) {
        toast.error("Failed to poll pending company outbound");
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {pollingData.map((data, index) => (
        <Card
          key={index}
          className="shadow-sm max-w-[95%] sm:min-w-[400px]"
          size={"4"}
        >
          <div className="relative flex flex-col gap-4">
            <Loader className="size-4 animate-spin -top-6 -right-6 absolute " />
            <Text size="4" weight="bold">
              Status: {data.status || "Pending"}
            </Text>

            <Flex direction={"row"} wrap={"wrap"} gap={"4"}>
              {data.companies?.map((company) => (
                <TooltipProvider key={company.id} delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link target="_blank" href={company.linkedinUrl}>
                        <Avatar
                          className="cursor-pointer shadow-md hover:scale-[101%] active:scale-[99%] transition-all"
                          color="blue"
                          size="2"
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
            <Text className="italic" size="3">
              {data.query || "nothing for now"}
            </Text>
            {/* <DialogRoot> */}
            {/*   <DialogTrigger> */}
            {/*     <Button style={{ cursor: "pointer" }}>View logs</Button> */}
            {/*   </DialogTrigger> */}
            {/*   <DialogContent> */}
            {/*     <ScrollArea> */}
            {/*       <div className="text-sm"> */}
            {/*         {data.logs ? data.logs : "No logs found"} */}
            {/*       </div> */}
            {/*     </ScrollArea> */}
            {/*   </DialogContent> */}
            {/* </DialogRoot> */}
            <Progress
              value={data.progress || 0}
              max={100}
              variant="surface"
              size={"2"}
            />
          </div>
        </Card>
      ))}
    </>
  );
}
