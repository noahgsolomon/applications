"use client";

import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { api as serverApi } from "@/trpc/server";
import {
  Text,
  Flex,
  Button,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  TextFieldInput,
  Switch,
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  DialogRoot,
  Card,
  Progress,
  ScrollArea,
} from "frosted-ui";
import { Loader, ScanSearch } from "lucide-react";
import { toast } from "sonner";

export default function OutboundDialog() {
  const [query, setQuery] = useState("");
  const [nearBrooklyn, setNearBrooklyn] = useState(false);
  const [job, setJob] = useState("Staff Frontend Engineer");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pollingData, setPollingData] =
    useState<
      Awaited<ReturnType<typeof serverApi.outbound.pollPendingOutbound>>
    >();
  const [existing, setExisting] = useState(false);
  const existingPendingOutboundQuery =
    api.outbound.existingPendingOutbound.useQuery();

  const outboundSearchesQuery = api.outbound.searches.useQuery(undefined, {
    enabled: false,
  });

  useEffect(() => {
    if (existingPendingOutboundQuery.data?.existing) {
      setExisting(true);
    } else {
      if (loading) {
        setLoading(false);
        setQuery("");
      }
    }
  }, [
    existingPendingOutboundQuery.isFetching,
    existingPendingOutboundQuery.data?.existing,
  ]);

  const pollPendingOutboundQuery =
    api.outbound.pollPendingOutbound.useMutation();

  const deletePendingOutboundMutation =
    api.outbound.deletePendingOutbound.useMutation();

  useEffect(() => {
    const poll = async () => {
      const response = await pollPendingOutboundQuery.mutateAsync({
        existingPendingOutboundId:
          (existingPendingOutboundQuery.data?.id as string) ?? "",
      });
      setPollingData(response);
      if (response?.progress === 100 || response?.status === "COMPLETED") {
        toast.success("Outbound search completed");
        outboundSearchesQuery.refetch();

        setExisting(false);
        setPollingData(undefined);
        deletePendingOutboundMutation.mutate({
          id: response.id,
        });
      }
    };

    let interval: any;
    if (existing) {
      poll();
      interval = setInterval(poll, 5000);
    }
    return () => clearInterval(interval);
  }, [existing, existingPendingOutboundQuery.data?.id]);

  const outboundMutation = api.outbound.addOutboundRequest.useMutation({
    onSuccess: (data) => {
      console.log("outbound mutation: " + data);
      // Handle success
      if (!data?.isValid) {
        setError("Invalid search query");
        setLoading(false);
        setQuery("");
      } else {
        existingPendingOutboundQuery.refetch();
      }
    },
    onError: (data) => {
      console.log("failed outbound mutation: " + data);
      setLoading(false);
    },
  });

  const handleSearch = () => {
    if (!query) {
      setError("Search query cannot be empty.");
      return;
    }
    setLoading(true);

    setError("");
    outboundMutation.mutate({ query, job, nearBrooklyn });
  };

  return (
    <>
      {existing && pollingData ? (
        <Card size={"4"}>
          <div className="relative flex flex-col gap-2">
            <Loader className="size-4 animate-spin -top-6 -right-6 absolute " />
            <Text size="4" weight="bold">
              Status: {pollingData?.status || "Pending"}
            </Text>
            <Text size="3">
              Query: {pollingData?.query || "nothing for now"}
            </Text>
            <Text size="3">Progress: {pollingData?.progress}%</Text>
            <DialogRoot>
              <DialogTrigger>
                <Text
                  size="3"
                  color="purple"
                  className="underline cursor-pointer"
                >
                  View logs
                </Text>
              </DialogTrigger>
              <DialogContent>
                <ScrollArea>
                  <div className="text-sm">
                    {pollingData.logs ? pollingData.logs : "No logs found"}
                  </div>
                </ScrollArea>
              </DialogContent>
            </DialogRoot>
            <Progress
              value={pollingData?.progress}
              max={100}
              variant="surface"
              size={"2"}
            />
          </div>
        </Card>
      ) : (
        <DialogRoot>
          <DialogTrigger>
            <Button style={{ cursor: "pointer" }} size={"4"} variant="surface">
              <div className="items-center flex flex-row gap-2">
                <ScanSearch className="size-6" />
              </div>
            </Button>
          </DialogTrigger>
          <DialogContent
            size="3"
            style={{
              maxWidth: 450,
            }}
          >
            <DialogTitle>Outbound Search</DialogTitle>
            <DialogDescription>
              Enter the details for the outbound search.
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
              </label>
              {error && (
                <Text as="div" size="2" color="red">
                  {error}
                </Text>
              )}
              <label>
                <Text as="div" mb="1" size="2" weight="bold">
                  Near Brooklyn
                </Text>
                <Switch
                  size="2"
                  checked={nearBrooklyn}
                  onCheckedChange={setNearBrooklyn}
                />
              </label>
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
                  "Search"
                )}
              </Button>
            </Flex>
          </DialogContent>
        </DialogRoot>
      )}
    </>
  );
}
