/// <reference path="./.sst/platform/config.d.ts" />
import { SubscriberEnv, NextEnv } from "./sst.env";

export default $config({
  app(input) {
    return {
      name: "applicationsnew",
      removal: "remove",
      home: "aws",
    };
  },
  async run() {
    const findSimilarProfilesLinkedinQueue = new sst.aws.Queue(
      "findSimilarProfilesLinkedinQueue",
      {
        visibilityTimeout: "10 minutes",
      },
    );
    const findSimilarProfilesGithubQueue = new sst.aws.Queue(
      "findSimilarProfilesGithubQueue",
      {
        visibilityTimeout: "10 minutes",
      },
    );

    findSimilarProfilesLinkedinQueue.subscribe({
      handler: "src/find-similar-profiles-linkedin-subscriber.handler",
      environment: SubscriberEnv,
      memory: "10240 MB",
      timeout: "10 minutes",
    });

    findSimilarProfilesGithubQueue.subscribe({
      handler: "src/find-similar-profiles-github-subscriber.handler",
      environment: SubscriberEnv,
      memory: "10240 MB",
      timeout: "10 minutes",
    });

    new sst.aws.Nextjs("WhopApplications", {
      environment: NextEnv,
      link: [findSimilarProfilesGithubQueue, findSimilarProfilesLinkedinQueue],
    });

    return {
      findSimilarProfilesLinkedinQueue: findSimilarProfilesLinkedinQueue.url,
      findSimilarProfilesGithubQueue: findSimilarProfilesGithubQueue.url,
    };
  },
});
