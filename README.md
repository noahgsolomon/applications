## 30,000 ft

There are three core files for the sourcing tool. Sourcing has to do with aggregating, vetting (scoring), and displaying.

The aggregating file is \`scripts/data-collection.ts\`
The scoring file is \`src/sort.ts\`
The displaying file is \`page.tsx\`

### Aggregating

The first step for sourcing is aggregating. We need a method of retrieving data from (ideally) solid ppl from the go, and then filtering more at the scoring layer. And then sorting at the visual layer. So there's multiple levels of filtering, and the first one is based on who we scrape and store.

The initial method was to type in Google search queries prefixed with 'site:www.linkedin.com/in', get the top n results, and then scrape those LinkedIn profiles, and store them.

Then, we realized it might be better to just store everyone from a given set of companies. That is what the 'company' table (schema found in \`server/db/schemas/users/schema.ts\`) is for. Storing those top companies.

We later moved onto a mixture approach when we hit with the limits of LinkedIn which is that it only shows first 2,000 employees for a company AND the CURRENT employees only.

Later, we decided it would be useful to score based on GitHub accounts. We didn't have a good way of getting GitHub accounts, emails, twitters, or actual quantity of work from LinkedIn, but we could get all these things including LinkedIn links from starting aggregation on GitHub. And because GitHub's GraphQL API has very flexible limits, it costs us $0 to pull from GitHub on the order of 10,000 profiles / day.

### People Table

The single object that represents a candidate is the people table (schema found in \`server/db/schemas/users/schema.ts\`). It has a ton of columns, but i'll just dump them here:

\`\`\`
id
name
email
image
linkedinUrl
linkedinData
githubLogin
githubImage
githubId
githubData
githubBio
githubCompany
isGithubCompanyChecked (temporary)
isEducationChecked (temporary)
twitterUsername
twitterId
twitterData
summary (not used)
miniSummary
workedInBigTech (not used)
livesNearBrooklyn (not used)
companyIds
cookdData (not used)
cookdScore (not used)
cookdReviewed (not used)
topTechnologies
jobTitles
topFeatures
isEngineer (not used)
createdAt
followers
following
followerToFollowingRatio
contributionYears
totalCommits
restrictedContributions
totalRepositories
totalStars
totalForks
githubLanguages
uniqueTopics
externalContributions
totalExternalCommits
sponsorsCount
sponsoredProjects
organizations
location
normalizedLocation
websiteUrl
isNearNyc (not used)
twitterFollowerCount
twitterFollowingCount
twitterFollowerToFollowingRatio
twitterBio
tweets
isUpsertedInAllBios
isWhopUser
isWhopCreator
sourceTables (temporary)
locationVector
averageSkillVector
averageSchoolVector
averageCompanyVector
averageFieldOfStudyVector
averageJobTitleVector
\`\`\`

Lots of columns, most of which contribute to the scoring like locationVector (\`src/sort.ts\`), and some which are just used for visualizing like miniSummary (\`app/page.tsx\`).

### TL;DR on how we get data

We find cracked orgs and cracked users on GitHub, and we scrape them, then we scrape all the orgs members or the users following list. And we do this with a depth of 2. And 'scraping' means getting the data from their GitHub, and seeing if they have a connected LinkedIn or Twitter, and if so, scraping that as well. Also getting things like email, location, etc.

### Scoring

Now that we have all the data we'd ever need, we need a way to make sense of it. Based on some conditional, _how_ is user_22 better than user_29 and by how much? How can we take in a textual input query representing an ideal candidate, and score the users accordingly, and do this in 1 minute or less, despite having 100,000's of stored candidates and millions of stored vector embeddings?

There are 2 main ways to score:

Based on a textual search query

GitHub and LinkedIn and Twitter ideal candidate URLs

Both of these methods can be used in tandem since both have normalized scores in a range of 0-1.

### Soft Filters vs Hard Filters

- **Soft filters**: Encourage the results to be near that search space (i.e. rewarding points to candidates who match that criteria like "is a whop user"). These types of filters only encourage the results to skew towards those given filters, but they don't filter absolutely.

- **Hard filters**: These are the buttons in the "View Candidates" modal (\`app/page.tsx\`) above the candidate cards (\`app/candidate-card.tsx\`). When you click a hard filter like 'has GitHub', or 'is whop user', then it will return only people who have said criteria of the 2000-8000 people returned from our scoring method (\`src/sort.ts\`).

### Companies View

There is also something somewhat aside, that is sort of a separate but integrated thing, which is sorting and filtering companies. This is in the \`app/companies-view.tsx\` component, and the backend logic for filtering companies based on name, common skills, and common features is in \`server/api/routers/company.ts\`.

### Scoring/Sorting/Filtering Criteria

Here are a list of things we score/sort/filter based on:

Location
School
Field of study
Active GitHub
Companies they've worked for
Job titles held
Skills
Features they've worked on
Is a whop user

for all of these except boolean conditions by nature like active github and is whop user must be resolved by the use of vector embeddings.The first step is to derive the values for all of the filter attributes based on the search query. We inform ChatGPT of the expected JSON it should generate based on these attributes as shown below (server/api/routes/company.ts):

\`
{
"companyNames": string[],
"otherCompanyNames": string[],
"job": string,
"skills": string[],
"location": string,
"schools": string[],
"fieldsOfStudy": string[]
}
\`

The location is normalized, so if the user inputs "SWE who knows x y z and lives in Brooklyn", it will make the location value "NEW YORK". Once we have all these values for these filter attributes we post this message into the queue (server/api/routes/outbound.ts). For location, company names, job titles, skills & features, schools, and fields of study, we convert all of these into vector embeddings. We then find the top k most similar vectors in the corresponding vector table (locationsVector, jobTitlesVectorNew, schools, fieldsOfStudy, companiesVectorNew, skillsNew). Each row contains n personIds, these n people have this exact same text we embedded and upserted into that embedding table. So if we return the top k skills from the skillsNew table for "Next.js", where k = 200, and the cosine similarity threshold is 0.5, but thresholding at 0.5 reduced that 200 number of rows to 80, and the average # of personIds each returned row of 80 gives us is 50, this means we will find 80\*50=400 different personIds that have the skill "Next.js".

When storing the embeddings of users schools, locations, skills, etc. we also normalize (lowercase all and trim) so that we reduce the number of matching rows for a given table are returned. the ideal is that the k value (e.g. 200) is always >= the number of rows that are above some threshold (e.g. 0.5). If that weren't the case, and 10,000 rows actually are above the 0.5 threshold, but we hard limit the amount of returns we're getting at 200, then that means we will only receive the top 200 / 10,000 matching candidates who know next.js, which means we just missed out on a lot of people who might be cracked.

So in the ui, you can change the weight of each filter attribute, and basically, everyone who's returned in the merged and flattened personIds list for next.js, will be documented as having said skill. And their score will be incremented by (pseudo code) person.nextjsSimilarityScore \* skills.nextjs.weightingProportionCoefficient. And we do this same thing for all other skills the user wants candidates to know. We then repeat this for location embedding, school embedding, field of study embedding, company names embedding, and job titles embedding if the filter criteria contains all these filters attributes for example.

We are now left with m*k*n peopleIds, where m is the number of filter attributes we have (# of skills + # of features + # of company names + # of job titles + # of schools + # of fields of study), k is the average number of personIds returned for each row returned for all filter attributes, and n is the average number of rows returned for each filter attribute.

A lot of times this is upwards of 50,000 people or more. And this is irrespective of how similar people we have scraped are to the filter criteria, because top k is what it sounds like: finding the top k people which is a relative measurement (the cosine similarity threshold is an absolute measurement but it is put low enough that it might return people who went to MIT when the filter criteria is harvard, so this isn't a problem). So for this reason, regardless of how specific a filter criteria is, it will always return enough people for the visualization.

We now have a list of personIds, and we need to normalize their scores between 0-1. We do this by calculating the mean and standard deviation for scores.

### Finding Similar Profiles

Now for finding similar profiles based on LinkedIn, GitHub, and Twitter URLs. We added this bc sometimes the best way to find the right candidates is to look at people similar to ones you already know are great.

#### 1. Processing LinkedIn URLs (\`processLinkedinUrls\`)

When we have LinkedIn URLs, we do the following:

- **Scrape the Profile**: We check if we already have the person in our \`people\` table. If not, we scrape their LinkedIn profile using the Scrapin API.
  
- **Generate Summaries and Skills**: Using OpenAI's GPT-4 model, we generate a mini-summary of their experience and extract their top skills, features they've worked on, and determine if they're likely an engineer.

- **Extract Key Data**: We pull out their job titles, company names, schools attended, and fields of study from their profile data.

- **Compute Embeddings**: For each of these pieces of data (skills, job titles, companies, schools, fields of study, and location), we generate vector embeddings using the \`text-embedding-ada-002\` model. This helps us compare and find similarities between different candidates.

- **Upsert Data into Embedding Tables**: We store these embeddings in their respective tables (\`skillsNew\`, \`jobTitlesVectorNew\`, \`companiesVectorNew\`, etc.) along with the person IDs.

- **Calculate Average Embeddings**: We compute average embeddings for each attribute to represent the candidate's overall profile in vector space.

- **Find Similar People**: We search for other candidates in our database whose embeddings are similar to the ones we've just computed.

- **Filter Based on Variance**: We calculate the variance of embeddings to ensure we're only considering attributes that are consistent across the profiles we're comparing.

- **Normalize Scores**: Finally, we normalize the similarity scores to be between 0 and 1 so we can rank the candidates.

#### 2. Processing GitHub URLs (\`processGitHubUrls\`)

When dealing with GitHub URLs, here's what happens:

- **Extract Usernames**: We parse the GitHub usernames from the URLs provided.

- **Fetch User Data**: We use the GitHub GraphQL API to fetch detailed user data, including their repositories, followers, languages used, etc.

- **Insert or Update Profiles**: If the user isn't already in our \`people\` table, we insert them with all their GitHub data.

- **Compute Embeddings**: Similar to LinkedIn, we compute embeddings for the skills (programming languages and topics), organizations, and location.

- **Calculate Average Embeddings**: We compute average embeddings for skills, organizations, and other attributes.

- **Find Similar People**: We perform similarity searches in our database to find candidates whose embeddings are close to those of the GitHub profiles we've just processed.

- **Normalize and Rank**: We normalize the scores and rank the candidates accordingly.

#### 3. Processing Filter Criteria (\`processFilterCriteria\`)

When a user provides specific filter criteria or a textual search query, here's our game plan:

- **Extract Filter Attributes**: We parse out the companies, job titles, skills, locations, schools, and fields of study from the query.

- **Generate Embeddings for Filters**: We create embeddings for each of these attributes to help in the similarity search.

- **Find Similar Attributes in Our Database**: For each attribute, we find similar entries in our embedding tables.

- **Aggregate Person IDs**: We collect the person IDs associated with these similar attributes.

- **Score Candidates**: We calculate a raw score for each candidate based on how closely they match the filter criteria.

- **Normalize Scores**: We normalize these scores to ensure fairness across different attributes.

- **Apply Weights**: The user can specify weights for each filter attribute, which we apply to calculate the final score for each candidate.

- **Sort and Return**: We sort the candidates by their final scores and return the top ones.

#### 4. Merging Results (\`mergeResults\`)

After we've got candidates from LinkedIn URLs, GitHub URLs, and filter criteria, we need to merge them:

- **Combine Candidates**: We merge the lists, ensuring we handle duplicates properly.

- **Aggregate Scores**: For candidates appearing in multiple lists, we sum their scores.

- **Merge Attributes**: We combine their matched skills, companies, job titles, etc.

- **Normalize Final Scores**: We normalize the aggregated scores one more time.

- **Final Sorting**: We sort the merged list to present the top candidates.

#### Scoring and Ranking

Our scoring system is designed to be flexible and fair:

- **Attribute Weights**: Users can adjust the importance of different attributes like skills, location, and companies.

- **Similarity Calculations**: We use cosine similarity between embeddings to score how well a candidate matches each attribute.

- **Normalization**: We normalize scores for consistency across different attributes.

- **Final Score**: We calculate a weighted sum of all attribute scores for each candidate.

- **Ranking**: Candidates are ranked based on their final scores, giving you the best matches at the top.

#### Good to knows

Here's some of the tech we're using under the hood:

- **Vector Embeddings**: Using OpenAI's models to turn text into vectors that we can mathematically compare.

- **Cosine Similarity**: This helps us measure how similar two vectors (and therefore two pieces of text) are.

- **PostgreSQL with Vector Extensions**: We store and query our embeddings efficiently right in the database.

- **Variance Calculations**: By calculating variance, we make sure that only consistent attributes among profiles influence our similarity search.

## Deep dive

### \`app/page.tsx\`:

\`page.tsx\` is the visual layer of our sourcing tool. This file is the heart of the user interface, where all the magic happens—users input their search queries, set their filters, and view the list of candidate matches.

### Overview

#### State Management

We use several \`useState\` hooks to manage the state of the component:

- **Loading States**: \`loading\`, \`filtersLoading\`, \`flushing\` to manage different loading states.
- **Error Handling**: \`error\` to display any error messages to the user.
- **User Inputs**: \`query\`, \`manualUrls\`, \`profileUrls\`, \`twitterUsernames\` to handle user-provided data.
- **Filters**: \`filters\`, \`filterWeights\` to manage and adjust search filters.
- **Candidate Data**: \`candidateMatches\`, \`ogCandidateMatches\`, \`allIdsResponse\` to store and manipulate the candidate data received from the server.
- **Toggle States**: \`showGithub\`, \`showLinkedin\`, \`showTwitter\`, \`showWhop\`, \`showActiveGithub\`, \`showMatchingLocation\` to control the visibility of various filter buttons and candidate lists.

#### Filter Management

The component allows users to input a search query and generate filters based on that query.

- **Search Query Input**: Users enter a query like "Software Engineer at Google with React experience".
- **Generate Filters**: Upon clicking "Generate Filters", the \`handleFilter\` function is invoked, which uses an API mutation (\`companyFilterMutation\`) to process the query and extract filters like companies, job titles, skills, and location.
- **Displaying Filters**: The extracted filters are displayed as interactive buttons that users can click to remove specific filters.

#### Filter Weights

Users can adjust the importance (weights) of different filters:

- **Initialization**: The \`initializeFilterWeights\` function sets up initial weights based on active filters.
- **Adjusting Weights**: Users can adjust weights using range sliders in a dialog.
- **Normalization**: The weights are normalized to ensure they sum up to 1, maintaining the balance of influence among filters.

#### Profile URLs Handling

Users can upload or manually input ideal candidate profile URLs:

- **Manual Input**: Users can paste URLs directly into a text area.
- **File Upload**: Users can upload a \`.txt\` or \`.csv\` file containing URLs.
- **URL Extraction**: The \`extractUrls\` function parses the input content and extracts LinkedIn, GitHub, and Twitter URLs.
- **Displaying URLs**: Extracted URLs are displayed as buttons, allowing users to remove any unwanted URLs.

#### Searching for Candidates

When users initiate a search:

- **Data Preparation**: The component compiles the filters, weights, and profile URLs into a payload.
- **API Call**: It sends this payload to the server via the \`insertIntoQueueMutation\` mutation.
- **Loading State**: The \`loading\` state is set to true to indicate that the search is in progress.

#### Receiving Candidate Matches

- **Polling for Results**: The component uses \`getPendingSimilarProfilesQuery\` to poll the server for search results at intervals.
- **Processing Results**: Once results are available, it updates \`candidateMatches\` and \`ogCandidateMatches\` with the data.
- **Error Handling**: If there's an error, it displays an error message and resets the loading state.

#### Displaying Candidates

- **Dialog Component**: The candidates are displayed inside a \`Dialog\` component when the user clicks "View Candidates".
- **Candidate Cards**: Each candidate is rendered using the \`CandidateCard\` component, which displays details like name, profile picture, matched skills, and other relevant information.
- **Sorting and Filtering**: Users can apply additional filters (e.g., "Has GitHub", "Active GitHub") to narrow down the candidate list.

#### Additional Features

- **CSV Download**: Users can download the list of candidates as a CSV file using the \`handleDownloadCsv\` function.
- **Cancel Search**: Users can cancel an ongoing search by flushing the queue.
- **Tooltips and Icons**: The UI includes tooltips and icons for better user experience and clarity.

### Key Functions and Hooks

#### \`handleFilter\`

Processes the search query to generate filters by calling the \`companyFilterMutation\` mutation. It updates the \`filters\` state with the extracted data.

#### \`handleWeightChange\`

Handles the adjustment of filter weights. It ensures that when one weight is increased, the others decrease proportionally to maintain a total weight sum of 1.

#### \`handleManualUrlsChange\` and \`handleFileProcessing\`

These functions extract URLs from user input or uploaded files and update the \`profileUrls\` state accordingly.

#### \`findSimilarProfiles\`

Compiles the profile URLs and filters into a payload and sends it to the server to find similar candidates.

#### \`handleProfileSearch\`

Initiates the candidate search by calling \`findSimilarProfiles\` and handles loading states and error messages.

### Child Components

#### \`CandidateCard\`

- **Purpose**: Renders individual candidate information.
- **Content**: Displays the candidate's name, profile picture, social links, matched attributes, and a relevance score.
- **Interactivity**: Includes badges and icons for visual cues about matched skills and other attributes.

### API Interactions

- **\`api.outbound.insertIntoQueue\`**: Sends the search payload to the server.
- **\`api.candidate.getPendingSimilarProfiles\`**: Polls the server for search results.
- **\`api.candidate.getAbsoluteFilteredTopCandidates\`**: Fetches candidates based on applied filters.
- **\`api.company.companyFilter\`**: Processes the search query to extract filters.
- **\`api.outbound.downloadAsCsv\`**: Downloads the candidate list as a CSV file.

### Error Handling and Loading States

- **Error Messages**: Displayed using the \`error\` state when something goes wrong.
- **Loading Indicators**: The \`loading\` and \`filtersLoading\` states control the display of loaders and disable inputs during ongoing operations.
- **Cancellation**: Users can cancel an ongoing search, which flushes the queue and resets states.

### User Experience Enhancements

- **Responsive Design**: The UI components adjust to different screen sizes for better accessibility.
- **Interactive Elements**: Buttons and sliders provide immediate feedback, enhancing interactivity.
- **Tooltips**: Provide additional information without cluttering the interface.
- **Visual Cues**: Icons and badges help users quickly identify the type of data (e.g., GitHub, LinkedIn profiles).

### \`src/sort.ts\`:

### Overview

The \`sort.ts\` file orchestrates several complex operations:

- **Data Retrieval**: Fetches candidate data from the database.
- **Embedding Generation**: Uses OpenAI's models to generate embeddings for text data.
- **Similarity Calculations**: Computes cosine similarities between embeddings.
- **Scoring and Ranking**: Assigns scores to candidates based on multiple criteria and ranks them.
- **Data Insertion**: Inserts new candidate data into the database when necessary.
- **API Interaction**: Handles API calls to LinkedIn and GitHub for data enrichment.

### Key Components and Functions

#### Import Statements and Configuration

At the beginning, the file imports necessary modules and sets up configurations:

- **Database Connection**: Establishes a connection to the PostgreSQL database using Drizzle ORM and Neon.
- **Schemas**: Imports database schemas from \`schema.ts\`.
- **OpenAI API**: Initializes the OpenAI client for generating embeddings and processing text.
- **GitHub API**: Sets up the GitHub GraphQL client for fetching user data.
- **Utilities**: Imports utility functions for rate limiting and embedding calculations.

#### Helper Functions

Several helper functions are defined to modularize the code:

\`\`\`ts
getEmbedding(text: string)
\`\`\`
Generates a vector embedding for a given text using OpenAI's \`text-embedding-ada-002\` model.

\`\`\`ts
computeAverageEmbedding(embeddings: number[][])
\`\`\`
Calculates the average of multiple embeddings.

\`\`\`ts
cosineSimilarity(a: number[], b: number[])
\`\`\`
Computes the cosine similarity between two vectors.

\`\`\`ts
calculateCosineSimilarityVariance(embeddings: number[][])
\`\`\`
Calculates the variance of cosine similarities among embeddings.

#### Data Fetching and Insertion Functions

These functions handle data retrieval and insertion into the database:

\`\`\`ts
scrapeLinkedInProfile(linkedinUrl: string)
\`\`\`
Fetches LinkedIn profile data using the Scrapin API.

\`\`\`ts
fetchGitHubUserData(username: string)
\`\`\`
Retrieves GitHub user data via the GitHub GraphQL API.

\`\`\`ts
insertPersonFromLinkedin(profileData: any)
\`\`\`
Inserts or updates a candidate's LinkedIn data into the database.

\`\`\`ts
insertPersonFromGithub(profileData: any)
\`\`\`
Inserts or updates a candidate's GitHub data into the database.

\`\`\`ts
upsertData(table: any, fieldName: string, fieldValue: string, vectorFieldName: string, personId: string)
\`\`\`
Inserts or updates embeddings and associated person IDs into various embedding tables.

#### Processing Functions

These functions process input data and prepare it for scoring:

\`\`\`ts
processLinkedinUrls(profileUrls: string[], insertId: string)
\`\`\`
Processes an array of LinkedIn URLs, scraping profiles, and generating embeddings.

\`\`\`ts
processGitHubUrls(githubUrls: string[], insertId: string)
\`\`\`
Processes GitHub URLs to fetch user data and generate embeddings.

\`\`\`ts
processFilterCriteria(filterCriteria: FilterCriteria)
\`\`\`
Processes filter criteria provided by the user, generates embeddings, and retrieves matching candidates.

#### Query Functions

These functions perform similarity searches in the database:

\`\`\`ts
querySimilarPeopleByEmbedding(vectorColumn, idColumn, table, embedding, topK, threshold)
\`\`\`
Finds people similar to the input embedding.

\`\`\`ts
querySimilarTechnologies(inputSkill: string, topK: number)
\`\`\`
Retrieves technologies similar to the input skill.

\`\`\`ts
querySimilarLocations(inputLocation: string, topK: number)
\`\`\`
Retrieves locations similar to the input location.

\`\`\`ts
querySimilarCompanies(inputCompany: string, topK: number)
\`\`\`
Retrieves companies similar to the input company.

\`\`\`ts
querySimilarJobTitles(inputJobTitle: string, topK: number)
\`\`\`
Retrieves job titles similar to the input job title.

\`\`\`ts
querySimilarSchools(inputSchool: string, topK: number)
\`\`\`
Retrieves schools similar to the input school.

\`\`\`ts
querySimilarFieldsOfStudy(inputFieldOfStudy: string, topK: number)
\`\`\`
Retrieves fields of study similar to the input field.

### Detailed Workflow

#### A. Processing LinkedIn URLs

1. **Normalization**: Cleans and normalizes LinkedIn URLs.
2. **Profile Retrieval**: Scrapes profiles using the Scrapin API if the candidate is not already in the database.
3. **Data Extraction**:
   - Generates a mini-summary and a detailed summary of the candidate's experience.
   - Extracts top skills, features, job titles, companies, schools, and fields of study.
4. **Embedding Generation**: Creates embeddings for skills, job titles, companies, schools, fields of study, and location.
5. **Data Insertion**: Inserts the candidate's data into the database, including average embeddings.

#### B. Processing GitHub URLs

1. **Username Extraction**: Parses GitHub usernames from URLs.
2. **Data Fetching**: Retrieves user data from the GitHub API, including repositories and contributions.
3. **Data Processing**:
   - Calculates metrics like total commits, stars, forks, and follower ratios.
   - Extracts languages, topics, and organizations.
4. **Embedding Generation**: Creates embeddings for skills (languages and topics) and location.
5. **Data Insertion**: Inserts the candidate's data into the database, including average embeddings.

#### C. Processing Filter Criteria

1. **Criteria Extraction**: Parses filter criteria provided by the user.
2. **Embedding Generation**: Generates embeddings for skills, job titles, companies, schools, fields of study, and location specified in the filter.
3. **Similarity Searches**: Queries the database to find similar entries based on embeddings.
4. **Candidate Scoring**:
   - Computes raw scores for each criterion.
   - Normalizes scores using statistical methods (mean, standard deviation).
   - Applies user-specified weights to each criterion.
5. **Active GitHub Scoring**: Calculates an 'active GitHub' score based on GitHub activity metrics.
6. **Final Scoring and Ranking**: Aggregates scores and ranks candidates.

#### D. Merging Results

1. **Combining Lists**: Merges candidates from LinkedIn URLs, GitHub URLs, and filter criteria.
2. **Score Aggregation**: Sums the scores for candidates appearing in multiple lists.
3. **Attribute Merging**: Combines matched skills, companies, job titles, etc.
4. **Final Sorting**: Sorts candidates based on the aggregated scores.

### Scoring Mechanism

The scoring mechanism is designed to be comprehensive and fair:

- **Raw Scores**: Calculated based on cosine similarities between embeddings.
- **Normalization**: Scores are normalized using statistical methods to ensure consistency.
- **Weights**: Users can adjust the importance of different criteria.
- **Active GitHub Score**: Assesses candidates' GitHub activity to identify active contributors.
- **Final Score**: Aggregates all normalized scores, considering user-defined weights.

### Database Interaction

The file interacts heavily with the database:

- **Tables Used**:
  - **\`people\`**: Stores candidate data.
  - **Embedding Tables**: \`skillsNew\`, \`jobTitlesVectorNew\`, \`companiesVectorNew\`, \`schools\`, \`fieldsOfStudy\`, \`locationsVector\`.
- **Data Operations**:
  - **Insertions**: Adds new candidates and embeddings.
  - **Updates**: Upserts data to avoid duplicates and keep information current.
  - **Queries**: Performs similarity searches and retrieves candidate information.

### OpenAI and GitHub API Usage

- **OpenAI API**:
  - **Embeddings**: Uses the \`text-embedding-ada-002\` model to generate embeddings for text data.
  - **Text Processing**: Generates summaries and extracts information using GPT-4 models.
- **GitHub API**:
  - **Data Retrieval**: Fetches detailed user data, including repositories and contributions.
  - **Rate Limiting**: Implements rate limiting to comply with API usage policies.

### Error Handling and Logging

- **Try-Catch Blocks**: Used extensively to catch and log errors during API calls and database operations.
- **Logging**: Provides detailed console logs to trace the execution flow and debug issues.

### Key Functions Explained

#### \`processFilterCriteria(filterCriteria: FilterCriteria)\`

- **Purpose**: Processes user-defined filter criteria to find matching candidates.
- **Steps**:
  1. **Data Retrieval**: Fetches candidates who match the specified companies.
  2. **Embedding Generation**: Generates embeddings for each criterion.
  3. **Similarity Searches**: Finds similar skills, locations, job titles, schools, and fields of study.
  4. **Score Calculation**:
     - Computes raw scores for each criterion.
     - Normalizes the scores.
     - Applies weights to calculate the final score.
  5. **Active GitHub Evaluation**: Assesses GitHub activity as part of the scoring.
  6. **Result Compilation**: Returns a list of candidates sorted by the final score.

#### \`mergeResults(...resultsArrays: any[][])\`

- **Purpose**: Merges multiple arrays of candidate results into a single, consolidated list.
- **Functionality**:
  - **Deduplication**: Ensures that each candidate appears only once.
  - **Score Aggregation**: Sums scores from different sources.
  - **Attribute Merging**: Combines matched attributes from all sources.
  - **Final Sorting**: Sorts the merged list based on the aggregated scores.

#### \`querySimilarPeopleByEmbedding(...)\`

- **Purpose**: Finds candidates similar to a given embedding vector.
- **Process**:
  - Uses SQL queries with cosine distance calculations.
  - Retrieves candidates whose embeddings are within a specified similarity threshold.
  - Orders the results based on similarity.

### Data Structures and Interfaces

- **\`FilterCriteria\` Interface**: Defines the structure for user-provided filter criteria, including weights and values for various attributes.
- **Candidate Representation**: Candidates are represented as objects containing their data, scores, and matched attributes.

### Optimization Techniques

- **Parallel Processing**: Uses \`Promise.all\` to execute independent asynchronous tasks concurrently.
- **Batch Processing**: Processes data in batches to improve performance and manage resources.
- **Embedding Caching**: Avoids redundant computations by checking for existing embeddings in the database.

## \`scripts/data-collection.ts\`

### Overview

The \`data-collection.ts\` script is designed to aggregate and enrich candidate data primarily from GitHub, LinkedIn, and Twitter. Its main objectives are:

- **Data Gathering**: Fetch detailed user data from GitHub, including repositories, contributions, followers, and more.
- **Data Enrichment**: Scrape LinkedIn profiles and fetch Twitter data if available.
- **Data Normalization**: Normalize locations and countries using OpenAI's GPT-4 model.
- **Vector Embeddings**: Generate embeddings for various attributes like skills, job titles, companies, and locations.
- **Database Operations**: Insert or update candidate data in the database, including embeddings for efficient querying.
- **Recursive Data Collection**: Traverse social graphs by processing the followers of candidates up to a certain depth.
- **Rate Limiting and Concurrency Control**: Manage API rate limits and control concurrency using queues and mutexes.

### Key Components and Functions

#### Import Statements and Configuration

- **Modules Imported**:
  - \`@octokit/graphql\`: For GitHub GraphQL API interactions.
  - \`RateLimiter\`: Custom rate limiter for GitHub API calls.
  - \`scrapeLinkedInProfile\`, \`gatherTopSkills\`, \`generateMiniSummary\`: Functions from the \`sort.ts\` module for data enrichment.
  - \`dotenv\`: For environment variable management.
  - \`drizzle-orm\` and \`@neondatabase/serverless\`: For database connections using Drizzle ORM and Neon.
  - \`OpenAI\`: For generating embeddings and normalizing data.
  - Database schemas from \`schema.ts\`.
  - Utility functions like \`chunk\`, \`Queue\`, and \`Mutex\` for concurrency control.

#### Helper Functions

- **Normalization Functions**:
  \`\`\`ts
  getNormalizedLocation(location: string)
  \`\`\`
  Uses OpenAI's GPT-4 model to normalize a location to an uppercase state or country name.
  \`\`\`ts
  getNormalizedCountry(location: string)
  \`\`\`
  Similar to the above but focuses on the country name.

- **Data Fetching Functions**:
  \`\`\`ts
  getTwitterData(username: string)
  \`\`\`
  Fetches Twitter data using the SocialData API.
  \`\`\`ts
  fetchGitHubUserData(username: string)
  \`\`\`
  Retrieves comprehensive GitHub user data via the GitHub GraphQL API.
  \`\`\`ts
  checkWhopStatus(email: string)
  \`\`\`
  Checks if a user is a Whop user or creator.

- **Embedding Functions**:
  \`\`\`ts
  getEmbedding(text: string)
  \`\`\`
  Generates a vector embedding for the given text using OpenAI's \`text-embedding-ada-002\` model.

  \`\`\`ts
  computeAverageEmbedding(embeddings: number[][])
  \`\`\`
  Calculates the average of multiple embeddings.

- **Database Operations**:
  \`\`\`ts
  upsertData(table: any, columnName: string, value: string, personId: string)
  \`\`\`
  Inserts or updates embeddings and associated person IDs into embedding tables.

  \`\`\`ts
  updatePersonEmbeddings(personId: string, updates: any)
  \`\`\`
  Updates a candidate's embeddings in the database.

  \`\`\`ts
  insertNewUser(userData: any, updates: any)
  \`\`\`
  Inserts a new candidate into the database.

  \`\`\`ts
  updateExistingUser(userId: string, updates: any)
  \`\`\`
  Updates an existing candidate's data.

#### Processing Functions

\`\`\`ts
processOrganizationWithSlidingWindow(orgName: string)
\`\`\`
Processes an organization or user by fetching its members and processing each member up to a certain depth.

\`\`\`ts
processUser(userData: any, depth: number)
\`\`\`
Processes a user, including computing and storing vectors, inserting or updating the user in the database, and recursively processing their followers up to a depth of 2.

\`\`\`ts
computeAndStoreVectorsForUser(userData: any)
\`\`\`
Computes embeddings for various user attributes and stores them in the database.

### Detailed Workflow

#### A. Initialization

1. **Environment Setup**: Loads environment variables using \`dotenv\`.
2. **API Clients Initialization**:
   - **OpenAI Client**: For embeddings and data normalization.
   - **GitHub GraphQL Client**: For fetching user data.
3. **Database Connection**: Establishes a connection to the PostgreSQL database using Drizzle ORM and Neon.

#### B. Processing Organizations and Users

1. **Organizations List**: Defines a list of GitHub usernames or organization names to process.
2. **Main Processing Loop**:
   - Iterates over each organization or user in the list.
   - Calls \`processOrganizationWithSlidingWindow\` for each.

#### C. Processing an Organization

1. **Member Retrieval**:
   - For each organization, retrieves its members (currently set to process the organization name as a user).
2. **Concurrency Control**:
   - Uses a \`Queue\` to manage the number of concurrent processing tasks (set to 100).
3. **Member Processing**:
   - For each member, calls \`processUser\`.

#### D. Processing a User

1. **Data Fetching**:
   - Calls \`fetchGitHubUserData\` to retrieve the user's GitHub data.
   - Fetches LinkedIn data if a LinkedIn URL is available.
   - Fetches Twitter data if a Twitter username is available.
   - Checks Whop status if an email is available.
2. **Data Enrichment**:
   - Normalizes the user's location and country.
   - Generates a mini-summary and gathers top skills from LinkedIn data.
3. **Embeddings Computation**:
   - Computes embeddings for location, skills, job titles, companies, schools, and fields of study.
   - Uses \`upsertData\` to insert or update embeddings in their respective tables.
4. **Database Insertion/Update**:
   - Checks if the user already exists in the database.
   - Inserts a new user or updates the existing user's data.
5. **Recursive Processing**:
   - Processes the user's following list up to a depth of 2 by recursively calling \`processUser\` on each.

#### E. Data Aggregation and Storage

1. **Embeddings Averaging**:
   - Averages embeddings for attributes with multiple entries (e.g., multiple skills or job titles).
2. **Mutexes for Concurrency**:
   - Uses \`Mutex\` locks when upserting data to prevent race conditions.
3. **Database Operations**:
   - Performs insertions and updates atomically to ensure data integrity.

### Database Interaction

- **Tables Used**:
  - **\`people\`**: Stores candidate data, including GitHub, LinkedIn, and Twitter information.
  - **Embedding Tables**:
    - \`skillsNew\`
    - \`jobTitlesVectorNew\`
    - \`companiesVectorNew\`
    - \`schools\`
    - \`fieldsOfStudy\`
    - \`locationsVector\`
- **Data Operations**:
  - **Insertions**: Adds new candidates and embeddings.
  - **Updates**: Upserts data to avoid duplicates and keep information current.
  - **Queries**: Checks for existing candidates and embeddings.

### API Usage

- **GitHub API**:
  - **Data Retrieval**: Fetches user data, including repositories, contributions, followers, following, organizations, sponsors, and social accounts.
  - **Rate Limiting**: Uses a custom \`RateLimiter\` to comply with GitHub API rate limits.
- **OpenAI API**:
  - **Embeddings**: Generates vector embeddings for text attributes.
  - **GPT-4 Model**: Normalizes locations and countries, and generates summaries.
- **SocialData API**:
  - **Twitter Data**: Fetches Twitter user data based on the username.
- **Whop API**:
  - **User Status**: Checks if a user is a Whop user or creator based on their email.

### Error Handling and Logging

- **Try-Catch Blocks**: Wraps API calls and database operations to catch and log errors.
- **Logging**:
  - **Console Outputs**: Provides detailed logs for each major step, including data fetching, processing, and database operations.
  - **Error Messages**: Logs error details to aid in debugging.

### Key Functions Explained

#### \`fetchGitHubUserData(username: string)\`

- **Purpose**: Retrieves and processes comprehensive GitHub user data.
- **Steps**:
  1. **Existence Check**: Skips processing if the user already exists in the database.
  2. **Data Fetching**: Uses GitHub GraphQL API to fetch user data.
  3. **Data Processing**:
     - Extracts LinkedIn URL from social accounts.
     - Calculates total commits, stars, forks, and processes languages and topics.
     - Normalizes location and country.
  4. **Data Enrichment**:
     - Fetches LinkedIn and Twitter data if available.
     - Checks Whop status using the user's email.
  5. **Data Aggregation**: Compiles all data into a single object for further processing.

#### \`processUser(userData: any, depth: number)\`

- **Purpose**: Processes a user's data, computes embeddings, and inserts or updates the user in the database.
- **Functionality**:
  - Checks if the user has already been processed.
  - Computes and stores embeddings for various attributes.
  - Inserts a new user or updates an existing user in the database.
  - Recursively processes the user's following list up to a depth of 2.

#### \`computeAndStoreVectorsForUser(userData: any)\`

- **Purpose**: Computes embeddings for user attributes and stores them in the database.
- **Attributes Processed**:
  - Location
  - Skills
  - Job Titles
  - Companies
  - Schools
  - Fields of Study
- **Functionality**:
  - Uses \`upsertData\` to insert or update embeddings.
  - Averages embeddings for attributes with multiple values.

#### \`upsertData(table: any, columnName: string, value: string, personId: string)\`

- **Purpose**: Inserts or updates a row in an embedding table.
- **Concurrency Control**: Uses a \`Mutex\` to prevent race conditions when multiple processes attempt to upsert the same value.
- **Functionality**:
  - Checks if the value already exists in the table.
  - If it exists, adds the \`personId\` to the \`personIds\` array.
  - If not, generates an embedding for the value and inserts it.

### Data Structures and Interfaces

- **Candidate Representation**: Candidates are represented as objects containing their data from GitHub, LinkedIn, and Twitter.
- **Embeddings**: Stored as arrays of numbers in the embedding tables, along with the associated text value and \`personIds\`.
- **WhopResponse Interface**: Defines the structure for the response from the Whop API.

### Optimization Techniques

- **Concurrency Control**:
  - Uses \`Queue\` to manage the number of concurrent API calls.
  - Employs \`Mutex\` locks when upserting data to prevent race conditions.
- **Rate Limiting**:
  - Implements \`RateLimiter\` to comply with GitHub API rate limits.
- **Batch Processing**:
  - Processes data in chunks where applicable to improve performance.
- **Caching**:
  - Checks for existing data in the database before making API calls to avoid redundant operations.

### Additional Notes

- **Depth Control**: The script processes followers up to a depth of 2 to avoid excessive API calls and data processing.
- **Processed Users Tracking**: Maintains a \`Set\` of processed users to prevent duplicate processing.
- **Flexibility**: The script can easily be modified to process different organizations or users by updating the \`organizations\` array.

### Execution Entry Point

- **\`main\` Function**: Orchestrates the entire data collection process by iterating over the list of organizations and initiating the processing.
- **Execution**:
  - The script starts by calling \`main()\`.
  - Logs when the processing of all organizations and their members is complete.