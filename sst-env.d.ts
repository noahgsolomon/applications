/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    WhopApplications: {
      type: "sst.aws.Nextjs"
      url: string
    }
    WhopQueue: {
      type: "sst.aws.Queue"
      url: string
    }
  }
}
export {}
