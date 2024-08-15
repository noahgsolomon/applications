type Outbound = {
  id: string;
  userId: string;
  query: string;
  job: string;
  nearBrooklyn: boolean;
  company: string;
  createdAt: Date | null;
} & {
  candidates: (InferSelectModel<typeof candidates> & {
    workedInPosition: boolean;
    workedAtRelevant: boolean;
    similarity: number;
    weight: number;
    matched: boolean;
    relevantSkills: string[];
    notRelevantSkills: string[];
  })[];
  matches: (InferSelectModel<typeof candidates> & {
    workedInPosition: boolean;
    workedAtRelevant: boolean;
    similarity: number;
    weight: number;
    matched: boolean;
    relevantSkills: string[];
    notRelevantSkills: string[];
  })[];
};

type Candidate = {
  linkedinData: any;
  livesNearBrooklyn: boolean | null;
  workedInBigTech: boolean | null;
  url: string;
  id: string;
  summary: string | null;
  createdAt: Date | null;
  miniSummary: string | null;
  relevantSkills: string[];
  notRelevantSkills: string[];
} & {
  workedInPosition?: boolean;
  workedAtRelevant?: boolean;
  similarity?: number;
  weight?: number;
  matched?: boolean;
};
