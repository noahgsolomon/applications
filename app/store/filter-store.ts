import { api as ServerApi } from "@/trpc/server";
import { create } from "zustand";

export type CompanyFilterReturnType = Awaited<
  ReturnType<typeof ServerApi.company.companyFilter>
>;

type ScrapedDialogStore = {
  open: boolean;
  setOpen: (open: boolean) => void;
  filters: CompanyFilterReturnType | null;
  setFilters: (filters: CompanyFilterReturnType | null) => void;
};

export const useScrapedDialogStore = create<ScrapedDialogStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  filters: null,
  setFilters: (filters) => set({ filters }),
}));
