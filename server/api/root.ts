import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { userRouter } from "./routers/users";
import { outboundRouter } from "./routers/outbound";

export const appRouter = createTRPCRouter({
  user: userRouter,
  outbound: outboundRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
