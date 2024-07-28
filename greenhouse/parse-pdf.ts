import axios from "axios";
import * as fs from "fs";
import * as path from "path";
// @ts-ignore
import pdf from "pdf-parse-debugging-disabled";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config({
  path: "../.env",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ApplicationData {
  name: string;
  location: string;
  education: Education[];
  workExperience: WorkExperience[];
  skills: string[];
  overallValue: string;
  category: string;
  links: Links;
  summary: string;
  phoneNumber?: string;
  email?: string;
}

interface Education {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string | null;
  endDate: string | null;
}

interface WorkExperience {
  company: string;
  position: string;
  startDate: string | null;
  endDate: string | null;
  responsibilities: string[];
}

interface Links {
  github?: string;
  linkedin?: string;
  portfolio?: string;
  projects?: string[];
}

interface Attachment {
  filename: string;
  url: string;
  type: string;
  created_at: string;
}

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
  attachments: Attachment[];
  s3_attachments?: Attachment[];
}

// Load applications from JSON file
const applications: Application[] = JSON.parse(
  fs.readFileSync("applicants.json", "utf8"),
);

async function downloadFile(url: string, filePath: string): Promise<void> {
  const writer = fs.createWriteStream(filePath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    let error: Error | null = null;
    writer.on("error", (err) => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on("close", () => {
      if (!error) {
        resolve();
      }
    });
  });
}

async function processAttachments() {
  for (const application of applications) {
    for (const attachment of application.attachments) {
      if (attachment.type === "resume") {
        const filePath = path.join("/tmp", attachment.filename);
        await downloadFile(attachment.url, filePath);

        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);

        const systemPrompt = `
        You are an AI assistant that extracts structured information from resumes. Your task is to parse the provided resume text and extract the following fields in JSON format:

        {
          "name": "string",
          "location": "string",
          "education": [
            {
              "institution": "string",
              "degree": "string",
              "fieldOfStudy": "string",
              "startDate": "string | null",
              "endDate": "string | null"
            }
          ],
          "workExperience": [
            {
              "company": "string",
              "position": "string",
              "startDate": "string | null",
              "endDate": "string | null",
              "responsibilities": ["string"]
            }
          ],
          "skills": ["string"],
          "overallValue": "string",
          "category": "string",
          "links": {
            "github": "string | null",
            "linkedin": "string | null",
            "portfolio": "string | null",
            "projects": ["string"]
          },
          "summary": "string",
          "phoneNumber: "string | null",
          "email": "string | null",
        }

        The "education" field includes a list of objects with institution, degree, field of study, and start and end dates.
        The "workExperience" field includes a list of objects with company, position, start and end dates, and responsibilities.
        The "links" field includes optional GitHub, LinkedIn, portfolio, and project links.
        The "category" field is a category describing the candidate's field (e.g., "UX Designer").
        The "overallValue" field is a brief description of the candidate's overall value.
        The "summary" field is an brief summary of the candidate's profile.
        The "phoneNumber" field should be in the form of ###-###-#### for their phone number
        The "skills" section should be limited to hard skills not soft skills like "communication".

        This means don't write any text in your return before or after the outer {}!!!!!
        `;

        const userPrompt = data.text;

        const completion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          model: "gpt-4o",
        });

        const content = completion.choices[0]?.message?.content || "";

        console.log(content);

        fs.unlinkSync(filePath);
      }
    }
  }
}

processAttachments();
