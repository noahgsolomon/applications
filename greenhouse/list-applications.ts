import axios from "axios";
import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config({
  path: "../.env",
});

const HARVEST_API_URL = "https://harvest.greenhouse.io/v1/applications";
const API_TOKEN = process.env.GREENHOUSE_API_KEY;

interface Application {
  id: number;
  candidate_id: number;
  prospect: boolean;
  applied_at: string;
  rejected_at: string | null;
  last_activity_at: string;
  location: { address: string } | null;
  source: { id: number; public_name: string } | null;
  credited_to: {
    id: number;
    first_name: string;
    last_name: string;
    name: string;
    employee_id: string | null;
  } | null;
  jobs: { id: number; name: string }[];
  job_post_id: number | null;
  status: string;
  current_stage: { id: number; name: string } | null;
  answers: { question: string; answer: string }[];
  prospective_office: any;
  prospective_department: any;
  prospect_detail: any;
  custom_fields: { [key: string]: string } | null;
  keyed_custom_fields: {
    [key: string]: { name: string; type: string; value: string };
  } | null;
  attachments: {
    filename: string;
    url: string;
    type: string;
    created_at: string;
  }[];
}

async function fetchApplications(
  page: number = 1,
  per_page: number = 100,
): Promise<Application[]> {
  const response = await axios.get(HARVEST_API_URL, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${API_TOKEN}:`).toString("base64")}`,
    },
    params: {
      page,
      per_page,
    },
  });
  return response.data;
}

async function getAllApplications(): Promise<Application[]> {
  let page = 1;
  const per_page = 500;
  let allApplications: Application[] = [];

  while (page < 100) {
    const applications = await fetchApplications(page, per_page);
    console.log(applications.length);
    if (applications.length === 0) break;
    allApplications = allApplications.concat(applications);
    page++;
  }

  return allApplications;
}

async function findApplicants() {
  try {
    const applications = await getAllApplications();
    const filteredApplications = applications
      .filter((app) => app.rejected_at === null)
      .sort(
        (a, b) =>
          new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime(),
      );

    console.log(
      "Applicants sorted by newest to oldest who have not been rejected:",
    );

    const jsonContent = JSON.stringify(filteredApplications, null, 2);
    fs.writeFileSync("applicants.json", jsonContent, "utf8");

    console.log("Data has been written to applicants.json");
  } catch (error) {
    console.error("Error fetching applications:", error);
  }
}

findApplicants();
