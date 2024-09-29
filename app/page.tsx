import ListeningCompanies from "./companies-listening";
import ScrapedDialog from "./scraped-dialog";

export default async function Home() {
  return (
    <div className="flex flex-col gap-12 items-center justify-center w-full h-[100vh]">
      <ScrapedDialog />
      {/* <ListeningCompanies /> */}
    </div>
  );
}
