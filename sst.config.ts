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
  },
});
