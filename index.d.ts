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
  })[];
  matches: (InferSelectModel<typeof candidates> & {
    workedInPosition: boolean;
    workedAtRelevant: boolean;
    similarity: number;
    weight: number;
    matched: boolean;
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
} & {
  workedInPosition: boolean;
  workedAtRelevant: boolean;
  similarity: number;
  weight: number;
  matched: boolean;
};
