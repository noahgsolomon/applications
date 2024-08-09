import OutboundDialog from "./outbound-dialog";
import CompanyDialog from "./company-dialog";
import PreviousOutboundSearchesButton from "./history/previous-outbound-searches-button";
import ListeningCompanies from "./companies-listening";
import PollingCompanyOutbound from "./polling-company-outbound";

export default async function Home() {
  // const user = await api.user.me();
  // if (!user.isLoggedIn) redirect("/login");

  return (
    <div className="flex flex-col gap-12 items-center justify-center w-full h-[100vh]">
      <PollingCompanyOutbound />
      <OutboundDialog />
      <CompanyDialog />
      <ListeningCompanies />
      <PreviousOutboundSearchesButton />
    </div>
  );
}
