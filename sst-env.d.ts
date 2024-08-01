/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    PoliticalBlogHono: {
      name: string
      type: "sst.aws.Function"
      url: string
    }
    WhopApplications: {
      type: "sst.aws.Nextjs"
      url: string
    }
  }
}
export {}
