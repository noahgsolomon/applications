## 30,000 ft

there are three core files for the sourcing tool. sourcing has to do with aggregating, vetting (scoring), and displaying. the aggregating file is scripts/data-collection.ts. The scoring file is src/score.ts. The displaying file is page.tsx.

the first step for sourcing is aggregating. we need a method of retrieving data from (ideally) solid ppl from the go, and then filtering more at the scoring layer. and then soring at the visual layer. so there's multiple levels of filtering, and the first one is based on who we scrape and store. The initial method was to type in google search queries prefixed with 'site:www.linkedin.com/in', get the top n results, and then scrape those linkedin profiles, and store them. Then, we realized it might be better to just store everyone from a given set of companies. That is what the 'company' table (schema found in server/db/schemas/users/schema.ts) is for. storing those top companies. We later moved onto a mixture approach when hit with the limits of linkedin which is that it only shows first 2,000 employees for a company AND the CURRENT employees only.

Later, we decided it would be useful to score based on github accounts. We didn't have a good way of getting github accounts, emails, twitters, or actual quantity of work from linkedin, but we could get all these things, including linkedin links we can scrape from starting aggregation on github. And because github's graphql API has very flexible limits, it costs us $0 to pull from github on the order of 10,000 profiles / day. The single object that represents a candidate is the people table (schema found in server/db/schemas/users/schema.ts). It has a ton of columns, but i'll just dump them here.

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

lots of columns, most of which contribute to the scoring like locationVector (src/score.ts), and some which are just used for visualizing like miniSummary (app/page.tsx). So TL;DR on how we get data, we find cracked orgs and cracked users on github, and we scrape them, then we scrape all the orgs members or the users following list. And we do this with a depth of 2. And 'scraping' means getting the data from their github, and seeing if they have a connected linkedin or twitter, and if so, scraping that as well. also getting things like email, location, etc.

now that we have all the data we'd ever need, we need a way to make sense of it. based on some conditional, _how_ is user_22 better than user_29 and by how much? How can we take in a textual input query representing an ideal candidate, and score the users accordingly, and do this in 1 minute or less, despite having 100,000's of stored candidates and millions of stored vector embeddings?

there are 2 main ways to score: based on a textual search query, and/or github and linkedin and twitter ideal candidate urls. Both of these methods can be used in tandem since both have normalized scores in a range of 0-1.

Also, there is a notion of soft filters and hard filters. Soft filters are filters that encourage the results to be near that search space (i.e. rewarding points to candidates who match that criteria like "is a whop user"). These types of filters only encourage the results to skew towards those given filters. but they don't filter absolutely. they used to, but no longer do they because search queries can get hyper specific, and the amount of possibile search queries far exceeds even the amount of candidates we have stored (at the current moment, 350,000). For example, a search query of "has worked at google and meta, and went to mit and studied CS and knows rails, terraform and next.js, and lives in NYC, and is a whop user. First of all, there might not be a person on earth that matches all that criteria, let alone in our database. So the idea was, no matter how specific a seach query is, let's just return the _most_ similar people, even despite the fact that no one fully matches.

For hard filters, these are the buttons in the "View Candidates" modal (app/page.tsx) above the candidate cards (app/candidate-card.tsx). When you click a filter of has github, or is whop user, then it will based on the top 2000-8000 people returned from our scoring method (src/score.ts), return only the people who in this case have a github and/or whop account.

There is also something somewhat aside, that is sort of a separate but integrated thing, which is sorting and filtering companies. This is in the app/companies-view.tsx component, and the backend logic for filtering companies based on name, common skills, and common features is in server/api/routers/company.ts. This is just one other soft filter. Which means, of these companies we scraped on linkedin we identify as "cracked", will be rewarded in the scoring algorithm? It could be some of them based on a textual filter, or none of them (by clicking remove all companies), or totally different companies (e.g. worked at the company "whop"). the companies view component is mostly just an aesthetically pleasing piece of ui, though, I think the filtering it useful, but all that we do with this information, is similarity search the company name and nothing more (for candidate scoring).

Here are a list of things we score/sort/filter based on:

- location
- school
- field of study
- active github
- companies they've worked for
- job titles held
- skills
- features they've worked on
- is a whop user

for all of these except boolean conditions by nature like active github and is whop user must be resolved by the use of vector embeddings.

## Deep dive
