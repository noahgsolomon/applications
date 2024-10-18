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
    const sortQueue = new sst.aws.Queue("SortQueue", {
      visibilityTimeout: "10 minutes",
    });
    sortQueue.subscribe({
      handler: "src/sort.handler",
      environment: SubscriberEnv,
      memory: "10240 MB",
      timeout: "10 minutes",
    });

    new sst.aws.Nextjs("WhopApplications", {
      environment: NextEnv,
      link: [sortQueue],
    });

    return {
      sortQueue: sortQueue.url,
    };
  },
});
