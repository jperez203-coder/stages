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
  pipeline: { id: string; name: string; emoji: string };
  assignees: TaskAssignee[];
};
