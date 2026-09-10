import { create } from "zustand";
import { http } from "../api/client";
import type { Project } from "../api/types";

interface ProjectState {
  projects: Project[];
  selectedProjectId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  selectProject: (id: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: localStorage.getItem("ff.project"),
  loading: false,

  async load() {
    const selected = get().selectedProjectId;
    set({ loading: true });
    try {
      const projects = await http.get<Project[]>("/api/projects");
      let selectedProjectId = selected && projects.some((p) => p.id === selected) ? selected : null;
      if (!selectedProjectId && projects.length > 0) selectedProjectId = projects[0].id;
      if (selectedProjectId) localStorage.setItem("ff.project", selectedProjectId);
      set({ projects, selectedProjectId, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  selectProject(id) {
    if (id) localStorage.setItem("ff.project", id);
    else localStorage.removeItem("ff.project");
    set({ selectedProjectId: id });
  },
}));