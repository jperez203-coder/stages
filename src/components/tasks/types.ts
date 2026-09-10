export type TaskAssignee = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  priority: "urgent" | "high" | "normal" | "low" | null;
  status: "not_started" | "in_progress";
  done: boolean;
  createdAt: string;
  /** `id` is always the task's real pipeline (tasks.stage_id is never
   *  null) — stays usable for things that work off pipeline_id regardless
   *  of display (attachments' storage path, RLS). `isSystem` is true only
   *  for the hidden per-workspace "Unassigned" pipeline (a task created
   *  without picking a project); display code should hide the name/emoji
   *  badge and route the Assignee picker to workspace members instead of
   *  pipeline members whenever this is true. */
  pipeline: { id: string; name: string; emoji: string; isSystem: boolean };
  assignees: TaskAssignee[];
};
