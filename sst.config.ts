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
      "FindSimilarProfilesLinkedinQueue",
      {
        visibilityTimeout: "10 minutes",
      }
    );
    findSimilarProfilesLinkedinQueue.subscribe({
      handler: "src/find-similar-profiles-linkedin-subscriber.handler",
      environment: SubscriberEnv,
      memory: "10240 MB",
      timeout: "10 minutes",
    });

    new sst.aws.Nextjs("WhopApplications", {
      environment: NextEnv,
      link: [findSimilarProfilesLinkedinQueue],
    });

    return {
      findSimilarProfilesLinkedinQueue: findSimilarProfilesLinkedinQueue.url,
    };
  },
});
