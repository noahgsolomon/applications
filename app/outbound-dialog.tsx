"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
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
} from "frosted-ui";
import { ScanSearch } from "lucide-react";

export default function OutboundDialog() {
  const [query, setQuery] = useState("");
  const [nearBrooklyn, setNearBrooklyn] = useState(false);
  const [job, setJob] = useState("Staff Frontend Engineer");

  const outbound = api.outbound.addOutboundRequest.useMutation({
    onSuccess: (data) => {},
  });

  const handleSearch = () => {
    outbound.mutate({ query, job, nearBrooklyn });
  };

  return (
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
          <label>
            <Text as="div" mb="1" size="2" weight="bold">
              Job Type
            </Text>
            <SelectRoot
              defaultValue="Staff Frontend Engineer"
              value={job}
              onValueChange={setJob}
            >
              <SelectTrigger />
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Job Types</SelectLabel>
                  <SelectItem value="Senior Design Engineer">
                    Senior Design Engineer
                  </SelectItem>
                  <SelectItem value="Senior Frontend Engineer">
                    Senior Frontend Engineer
                  </SelectItem>
                  <SelectItem value="Senior Fullstack Engineer">
                    Senior Fullstack Engineer
                  </SelectItem>
                  <SelectItem value="Senior iOS Engineer">
                    Senior iOS Engineer
                  </SelectItem>
                  <SelectItem value="Staff Frontend Engineer">
                    Staff Frontend Engineer
                  </SelectItem>
                  <SelectItem value="Staff Infrastructure Engineer">
                    Staff Infrastructure Engineer
                  </SelectItem>
                  <SelectItem value="Staff iOS Engineer">
                    Staff iOS Engineer
                  </SelectItem>
                  <SelectItem value="Staff Rails Engineer">
                    Staff Rails Engineer
                  </SelectItem>
                  <SelectItem value="Creator Partnerships Lead">
                    Creator Partnerships Lead
                  </SelectItem>
                  <SelectItem value="Customer Support Specialist">
                    Customer Support Specialist
                  </SelectItem>
                  <SelectItem value="Head of New Verticals">
                    Head of New Verticals
                  </SelectItem>
                  <SelectItem value="Senior Growth Data Analyst">
                    Senior Growth Data Analyst
                  </SelectItem>
                  <SelectItem value="Senior Lifecycle Marketing Manager">
                    Senior Lifecycle Marketing Manager
                  </SelectItem>
                  <SelectItem value="Senior Product Marketing Manager, Consumer">
                    Senior Product Marketing Manager, Consumer
                  </SelectItem>
                  <SelectItem value="Senior Product Marketing Manager, Creator">
                    Senior Product Marketing Manager, Creator
                  </SelectItem>
                  <SelectItem value="Social Media Lead">
                    Social Media Lead
                  </SelectItem>
                  <SelectItem value="Accounting Manager">
                    Accounting Manager
                  </SelectItem>
                  <SelectItem value="Executive Assistant">
                    Executive Assistant
                  </SelectItem>
                  <SelectItem value="Office Manager">Office Manager</SelectItem>
                  <SelectItem value="Senior Brand Designer">
                    Senior Brand Designer
                  </SelectItem>
                  <SelectItem value="Senior Product Designer, Creators">
                    Senior Product Designer, Creators
                  </SelectItem>
                  <SelectItem value="Senior Product Designer, User Growth & Engagement">
                    Senior Product Designer, User Growth & Engagement
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </SelectRoot>
          </label>
        </Flex>
        <Flex gap="3" justify="end" mt="4">
          <DialogClose>
            <Button color="gray" variant="soft">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose>
            <Button variant="classic" onClick={handleSearch}>
              Search
            </Button>
          </DialogClose>
        </Flex>
      </DialogContent>
    </DialogRoot>
  );
}
