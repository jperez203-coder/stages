// Shared constants ported verbatim from the prototype.

export const STAGE_COLORS = [
  "#3BA5EE", "#8B5CF6", "#EC4899", "#F59E0B",
  "#10B981", "#06B6D4", "#F43F5E", "#3B82F6",
  "#A855F7", "#14B8A6", "#EAB308", "#EF4444",
];

export const pickColor = (idx: number): string =>
  STAGE_COLORS[idx % STAGE_COLORS.length];

export type StarterTemplate = {
  name: string;
  description: string;
  icon: string;
  stages: Array<{ name: string; tasks: string[] }>;
};

export const TEMPLATES: Record<string, StarterTemplate> = {
  ads: {
    name: "Paid Ads Onboarding",
    description: "Lead → onboarding → creative → launch → optimize → scale",
    icon: "📈",
    stages: [
      { name: "Lead Captured", tasks: ["Discovery call", "Send proposal", "Contract signed", "Payment received"] },
      { name: "Onboarding", tasks: ["Ad account access", "Pixel / tracking installed", "CRM integration", "Brand assets collected"] },
      { name: "Creative Build", tasks: ["Creative brief approved", "Ad sets drafted", "Copy variations", "Client approval"] },
      { name: "Ads Launched", tasks: ["Campaign structure", "Audiences configured", "Budget pacing", "Campaign live"] },
      { name: "Optimizing", tasks: ["7-day data review", "Kill underperformers", "Test new audiences", "Hit target ROAS"] },
      { name: "Scaling", tasks: ["Scale winners", "Lookalike expansion", "Creative refresh", "Monthly report"] },
    ],
  },
  agency: {
    name: "Agency Project Workflow",
    description: "Brief → discovery → design → build → review → handoff",
    icon: "🎨",
    stages: [
      { name: "Brief", tasks: ["Initial intake form", "Scope alignment", "Timeline agreed"] },
      { name: "Discovery", tasks: ["Stakeholder interviews", "Competitive research", "Audit findings"] },
      { name: "Design", tasks: ["Wireframes", "Visual direction", "Final mockups", "Design review"] },
      { name: "Build", tasks: ["Development kickoff", "QA pass", "Staging review"] },
      { name: "Review", tasks: ["Client feedback round 1", "Revisions", "Final approval"] },
      { name: "Handoff", tasks: ["Production deploy", "Documentation", "Training session"] },
    ],
  },
  sales: {
    name: "Sales Pipeline",
    description: "Qualify → demo → proposal → negotiate → won",
    icon: "💼",
    stages: [
      { name: "Qualified", tasks: ["Discovery call booked", "Budget confirmed", "Decision-maker identified"] },
      { name: "Demo", tasks: ["Demo scheduled", "Demo delivered", "Follow-up sent"] },
      { name: "Proposal", tasks: ["Proposal drafted", "Pricing approved", "Sent to client"] },
      { name: "Negotiate", tasks: ["Terms reviewed", "Redlines addressed", "Final ToS"] },
      { name: "Closed Won", tasks: ["Contract signed", "Payment received", "Kickoff scheduled"] },
    ],
  },
};

// Storage keys — preserved verbatim. Phase 4 swaps these for Supabase queries.
export const STORAGE_KEY = "workspace_data_v4";
export const SESSION_KEY = "workspace_session_v4";
export const INVITES_KEY = "workspace_invites_v4";
export const CLIENT_INVITES_KEY = "client_invites_v1";
export const READSTATE_KEY = "workspace_reads_v4";
export const WORKSPACES_KEY = "workspaces_v1";
export const ACTIVE_WS_KEY = "active_workspace_v1";
export const USER_TEMPLATES_KEY = "user_templates_v1";

// Canvas layout constants
export const COL_WIDTH = 220;
export const COL_GAP = 80;
export const HEADER_Y = 60;
export const PADDING_LEFT = 60;

export const colX = (i: number): number =>
  PADDING_LEFT + i * (COL_WIDTH + COL_GAP);
