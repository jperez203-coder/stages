export type TaskAssignee = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  deadline: string | null;
  priority: "urgent" | "high" | "normal" | "low" | null;
  status: "not_started" | "in_progress";
  createdAt: string;
  pipeline: { id: string; name: string; emoji: string };
  assignees: TaskAssignee[];
};
