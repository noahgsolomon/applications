## 30,000 ft

There are three core files for the sourcing tool. Sourcing has to do with aggregating, vetting (scoring), and displaying.

- The aggregating file is `scripts/data-collection.ts`
- The scoring file is `src/score.ts`
- The displaying file is `page.tsx`

### Aggregating

The first step for sourcing is aggregating. We need a method of retrieving data from (ideally) solid ppl from the go, and then filtering more at the scoring layer. And then soring at the visual layer. So there's multiple levels of filtering, and the first one is based on who we scrape and store.

1. The initial method was to type in Google search queries prefixed with 'site:www.linkedin.com/in', get the top n results, and then scrape those LinkedIn profiles, and store them.
2. Then, we realized it might be better to just store everyone from a given set of companies. That is what the 'company' table (schema found in `server/db/schemas/users/schema.ts`) is for. Storing those top companies.
3. We later moved onto a mixture approach when hit with the limits of LinkedIn which is that it only shows first 2,000 employees for a company AND the CURRENT employees only.

Later, we decided it would be useful to score based on GitHub accounts. We didn't have a good way of getting GitHub accounts, emails, twitters, or actual quantity of work from LinkedIn, but we could get all these things, including LinkedIn links we can scrape from starting aggregation on GitHub. And because GitHub's GraphQL API has very flexible limits, it costs us $0 to pull from GitHub on the order of 10,000 profiles / day.

### People Table

The single object that represents a candidate is the people table (schema found in `server/db/schemas/users/schema.ts`). It has a ton of columns, but i'll just dump them here:

[List of columns...]

Lots of columns, most of which contribute to the scoring like locationVector (`src/score.ts`), and some which are just used for visualizing like miniSummary (`app/page.tsx`).

### TL;DR on how we get data

We find cracked orgs and cracked users on GitHub, and we scrape them, then we scrape all the orgs members or the users following list. And we do this with a depth of 2. And 'scraping' means getting the data from their GitHub, and seeing if they have a connected LinkedIn or Twitter, and if so, scraping that as well. Also getting things like email, location, etc.

### Scoring

Now that we have all the data we'd ever need, we need a way to make sense of it. Based on some conditional, _how_ is user_22 better than user_29 and by how much? How can we take in a textual input query representing an ideal candidate, and score the users accordingly, and do this in 1 minute or less, despite having 100,000's of stored candidates and millions of stored vector embeddings?

There are 2 main ways to score:

1. Based on a textual search query
2. GitHub and LinkedIn and Twitter ideal candidate URLs

Both of these methods can be used in tandem since both have normalized scores in a range of 0-1.

#### Soft Filters vs Hard Filters

- **Soft filters**: Encourage the results to be near that search space (i.e. rewarding points to candidates who match that criteria like "is a whop user"). These types of filters only encourage the results to skew towards those given filters, but they don't filter absolutely.

- **Hard filters**: These are the buttons in the "View Candidates" modal (`app/page.tsx`) above the candidate cards (`app/candidate-card.tsx`). When you click a filter of has GitHub, or is whop user, then it will based on the top 2000-8000 people returned from our scoring method (`src/score.ts`), return only the people who in this case have a GitHub and/or whop account.

### Companies View

There is also something somewhat aside, that is sort of a separate but integrated thing, which is sorting and filtering companies. This is in the `app/companies-view.tsx` component, and the backend logic for filtering companies based on name, common skills, and common features is in `server/api/routers/company.ts`.

### Scoring/Sorting/Filtering Criteria

Here are a list of things we score/sort/filter based on:

- Location
- School
- Field of study
- Active GitHub
- Companies they've worked for
- Job titles held
- Skills
- Features they've worked on
- Is a whop user

for all of these except boolean conditions by nature like active github and is whop user must be resolved by the use of vector embeddings.The first step is to derive the values for all of the filter attributes based on the search query. We inform ChatGPT of the expected JSON it should generate based on these attributes as shown below (server/api/routes/company.ts):

{
"companyNames": string[],
"otherCompanyNames": string[],
"job": string,
"skills": string[],
"location": string,
"schools": string[],
"fieldsOfStudy": string[]
}

The location is normalized, so if the user inputs "SWE who knows x y z and lives in Brooklyn", it will make the location value "NEW YORK". Once we have all these values for these filter attributes we post this message into the queue (server/api/routes/outbound.ts). For location, company names, job titles, skills & features, schools, and fields of study, we convert all of these into vector embeddings. We then find the top k most similar vectors in the corresponding vector table (locationsVector, jobTitlesVectorNew, schools, fieldsOfStudy, companiesVectorNew, skillsNew). Each row contains n personIds, these n people have this exact same text we embedded and upserted into that embedding table. So if we return the top k skills from the skillsNew table for "Next.js", where k = 200, and the cosine similarity threshold is 0.5, but thresholding at 0.5 reduced that 200 number of rows to 80, and the average # of personIds each returned row of 80 gives us is 50, this means we will find 80\*50=400 different personIds that have the skill "Next.js".

When storing the embeddings of users schools, locations, skills, etc. we also normalize (lowercase all and trim) so that we reduce the number of matching rows for a given table are returned. the ideal is that the k value (e.g. 200) is always >= the number of rows that are above some threshold (e.g. 0.5). If that weren't the case, and 10,000 rows actually are above the 0.5 threshold, but we hard limit the amount of returns we're getting at 200, then that means we will only receive the top 200 / 10,000 matching candidates who know next.js, which means we just missed out on a lot of people who might be cracked.

So in the ui, you can change the weight of each filter attribute, and basically, everyone who's returned in the merged and flattened personIds list for next.js, will be documented as having said skill. And their score will be incremented by (pseudo code) person.nextjsSimilarityScore \* skills.nextjs.weightingProportionCoefficient. And we do this same thing for all other skills the user wants candidates to know. We then repeat this for location embedding, school embedding, field of study embedding, company names embedding, and job titles embedding if the filter criteria contains all these filters attributes for example.

We are now left with m*k*n peopleIds, where m is the number of filter attributes we have (# of skills + # of features + # of company names + # of job titles + # of schools + # of fields of study), k is the average number of personIds returned for each row returned for all filter attributes, and n is the average number of rows returned for each filter attribute.

A lot of times this is upwards of 50,000 people or more. And this is irrespective of how similar people we have scraped are to the filter criteria, because top k is what it sounds like: finding the top k people which is a relative measurement (the cosine similarity threshold is an absolute measurement but it is put low enough that it might return people who went to MIT when the filter criteria is harvard, so this isn't a problem). So for this reason, regardless of how specific a filter criteria is, it will always return enough people for the visualization.

## Deep dive
