/// <reference path="./.sst/platform/config.d.ts" />
import { NextEnv } from "./sst.env";

export default $config({
  app(input) {
    return {
      name: "applicationsnew",
      removal: "remove",
      home: "aws",
    };
  },
  async run() {
    new sst.aws.Nextjs("WhopApplications", {
      environment: NextEnv,
    });

    const hono = new sst.aws.Function("PoliticalBlogHono", {
      url: true,
      handler: "src/hono.handler",
    });

    return {
      api: hono.url,
    };
  },
});
