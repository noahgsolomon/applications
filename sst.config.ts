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
    //
    // const hono = new sst.aws.Function("PoliticalBlogHono", {
    //   environment: HonoEnv,
    //   url: true,
    //   handler: "src/hono.handler",
    // });

    const queue = new sst.aws.Queue("WhopQueue");

    queue.subscribe({
      handler: "src/subscriber.handler",
      environment: SubscriberEnv,
      timeout: "10 minutes",
    });

    new sst.aws.Nextjs("WhopApplications", {
      environment: NextEnv,
      link: [queue],
    });

    return {
      queue: queue.url,
    };
  },
});
