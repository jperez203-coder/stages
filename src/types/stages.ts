// Type definitions for Stages prototype data shapes.
// Mirrors `Client Workspaces.jsx` so the migration is mechanical.
// Phase 3 schema may diverge — see CLAUDE.md "Identity model".

export type Workspace = {
  id: string;
  name: string;
  ownerEmail: string;
  createdAt: number;
};

export type MemberRole = "member" | "admin";

export type Member = {
  email: string;
  joinedAt: number;
  role: MemberRole;
  canSubmit: boolean;
};

export type TaskPosition = { x: number; y: number };

export type Task = {
  id: string;
  text: string;
  done: boolean;
  pos: TaskPosition | null;
  deadline: number | null;
  note?: string;
  clientVisible?: boolean;
};

export type StageNote = {
  id: string;
  text: string;
  author: string;
  ts: number;
  editedAt?: number;
  clientVisible?: boolean;
};

export type StageAttachment = {
  id: string;
  label: string;
  kind: "image";
  dataUrl: string;
  fileName: string;
  fileSize: number;
  addedBy: string;
  ts: number;
  clientVisible: boolean;
};

export type Stage = {
  id: string;
  name: string;
  description: string;
  deadline: number | null;
  color: string;
  completed: boolean;
  completedAt: number | null;
  notes: StageNote[];
  tasks: Task[];
  attachments?: StageAttachment[];
  clientVisible?: boolean;
};

export type Message = {
  id: string;
  author: string;
  text: string;
  ts: number;
  mentions: string[];
  internal: boolean;
};

export type Channel = {
  id: string;
  name: string;
  isClient: boolean;
  memberEmails: string[];
  createdAt: number;
  createdBy: string;
  messages: Message[];
};

export type Link = {
  id: string;
  label: string;
  kind: "url" | "image";
  url?: string;
  dataUrl?: string;
  fileName?: string;
  fileSize?: number;
  addedBy: string;
  ts: number;
  clientVisible: boolean;
};

export type ActivityType =
  | "stage_advanced"
  | "member_joined"
  | "client_created"
  | "pipeline_submitted";

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  who: string;
  ts: number;
  stageName?: string;
};

// "Client" and "Pipeline" are the same thing in the prototype — kept as an
// alias so call sites can read naturally either way.
export type Pipeline = {
  id: string;
  name: string;
  company: string;
  emoji: string;
  ownerEmail: string;
  workspaceId: string | null;
  members: Member[];
  template: string;
  createdAt: number;
  lastEdited: number;
  currentStage: string;
  /** Legacy flat thread; superseded by `channels` (kept for back-compat). */
  messages: Message[];
  links: Link[];
  activity: ActivityEntry[];
  stages: Stage[];
  channels: Channel[];
  submittedAt?: number;
  submittedBy?: string;
};
export type Client = Pipeline;

export type TeamInvite = {
  clientId: string;
  email: string;
  invitedBy: string;
  createdAt: number;
  accepted: boolean;
  acceptedEmail?: string;
};

export type ClientInvite = {
  clientId: string;
  clientEmail: string;
  agencyEmail: string;
  accepted: boolean;
  ts: number;
  acceptedAt?: number;
};

export type UserTemplate = {
  id: string;
  name: string;
  icon: string;
  description: string;
  ownerEmail: string;
  createdAt: number;
  stages: Array<{ name: string; tasks: string[] }>;
};

export type Session = {
  email: string;
  role: "owner" | "member";
};

export type ClientSession = {
  email: string;
  clientId: string;
  role: "client";
  token: string;
};

export type ToastEntry = {
  id: number;
  message: string;
  type: "success" | "info";
};

export type DeadlineStatus = "overdue" | "today" | "soon" | "future";
