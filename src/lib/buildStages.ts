import { TEMPLATES, pickColor } from "./constants";
import type { Stage, UserTemplate } from "@/types/stages";

export function buildStages(
  templateKey: string | null,
  userTemplate: UserTemplate | null = null,
): Stage[] {
  // User-saved template takes priority if matched by id.
  // Templates intentionally don't carry deadlines forward — every new pipeline
  // starts with a clean slate of dates so users set fresh ones for the new
  // client.
  if (userTemplate) {
    return userTemplate.stages.map((s, i) => ({
      id: `s_${Date.now()}_${i}`,
      name: s.name,
      description: "",
      deadline: null,
      color: pickColor(i),
      completed: false,
      completedAt: null,
      notes: [],
      tasks: (s.tasks || []).map((t, ti) => ({
        id: `t_${Date.now()}_${i}_${ti}`,
        text: t,
        done: false,
        pos: null,
        deadline: null,
      })),
    }));
  }
  if (templateKey === "blank" || !templateKey || !TEMPLATES[templateKey]) {
    return [
      {
        id: `s_${Date.now()}_0`,
        name: "Stage 1",
        description: "",
        deadline: null,
        color: pickColor(0),
        completed: false,
        completedAt: null,
        notes: [],
        tasks: [],
      },
    ];
  }
  const tpl = TEMPLATES[templateKey];
  return tpl.stages.map((s, i) => ({
    id: `s_${Date.now()}_${i}`,
    name: s.name,
    description: "",
    deadline: null,
    color: pickColor(i),
    completed: false,
    completedAt: null,
    notes: [],
    tasks: s.tasks.map((t, ti) => ({
      id: `t_${Date.now()}_${i}_${ti}`,
      text: t,
      done: false,
      pos: null,
      deadline: null,
    })),
  }));
}
