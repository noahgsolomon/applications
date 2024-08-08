import { api } from "@/trpc/server";
import { Container, Flex } from "frosted-ui";
import { redirect } from "next/navigation";
import OutboundDialog from "./outbound-dialog";
import CompanyDialog from "./company-dialog";
import PreviousOutboundSearchesButton from "./history/previous-outbound-searches-button";

export default async function Home() {
  // const user = await api.user.me();
  // if (!user.isLoggedIn) redirect("/login");

  return (
    <div className="flex flex-col gap-12 items-center justify-center w-full h-[100vh]">
      <OutboundDialog />
      <CompanyDialog />
      <PreviousOutboundSearchesButton />
    </div>
  );
}
