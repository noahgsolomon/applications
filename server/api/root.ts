import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { outboundRouter } from "./routers/outbound";
import { companyRouter } from "./routers/company";
import { candidateRouter } from "./routers/candidate";

export const appRouter = createTRPCRouter({
  outbound: outboundRouter,
  candidate: candidateRouter,
  company: companyRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
