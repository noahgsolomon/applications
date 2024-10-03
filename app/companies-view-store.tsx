import { create } from "zustand";

type CompaniesViewStore = {
  companiesRemoved: boolean;
  setCompaniesRemoved: (removed: boolean) => void;
};

export const useCompaniesViewStore = create<CompaniesViewStore>((set) => ({
  companiesRemoved: false,
  setCompaniesRemoved: (removed) => set({ companiesRemoved: removed }),
}));
