"use client";

import { useEffect, useState } from "react";

import {
  ACTIVE_WS_KEY,
  CLIENT_INVITES_KEY,
  INVITES_KEY,
  pickColor,
  READSTATE_KEY,
  SESSION_KEY,
  STORAGE_KEY,
  USER_TEMPLATES_KEY,
  WORKSPACES_KEY,
} from "@/lib/constants";
import { buildStages } from "@/lib/buildStages";
import { installStorageStub } from "@/lib/storage";
import type {
  ActivityEntry,
  Channel,
  Client,
  ClientInvite,
  ClientSession,
  Member,
  Pipeline,
  Session,
  Stage,
  StageAttachment,
  StageNote,
  TaskPosition,
  TeamInvite,
  ToastEntry,
  UserTemplate,
  Workspace,
} from "@/types/stages";

// Install the storage stub once at module load (idempotent, SSR-safe).
installStorageStub();

export type PendingTeamInvite = TeamInvite & { token: string };
export type PendingClientInvite = ClientInvite & { token: string };
export type BoardTab = "canvas" | "thread" | "activity" | "links" | "members";

// Helper: append a new activity entry (immutable update).
function withActivity(c: Client, entry: Omit<ActivityEntry, "id" | "ts"> & { ts?: number }): Client {
  return {
    ...c,
    activity: [
      ...(c.activity || []),
      {
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        ...entry,
      } as ActivityEntry,
    ],
  };
}

// Helper: notes can arrive as legacy string / single object / array. Normalize.
function normalizeNotes(notes: unknown): StageNote[] {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes as StageNote[];
  if (typeof notes === "string") {
    return notes.trim()
      ? [{ id: `n_legacy_${Date.now()}`, text: notes, author: "unknown", ts: Date.now() }]
      : [];
  }
  if (typeof notes === "object" && notes !== null && "text" in notes) {
    const obj = notes as { text: string; author?: string; ts?: number };
    return [
      {
        id: `n_legacy_${obj.ts ?? Date.now()}`,
        text: obj.text,
        author: obj.author || "unknown",
        ts: obj.ts ?? Date.now(),
      },
    ];
  }
  return [];
}

// Helper: ensure the channels array exists, building a default "general" from
// the legacy top-level `messages` array if needed.
function ensureChannels(c: Pipeline): Channel[] {
  if (Array.isArray(c.channels) && c.channels.length > 0) return c.channels;
  return [
    {
      id: `ch_${c.id}_general`,
      name: "general",
      isClient: false,
      memberEmails: [c.ownerEmail],
      createdAt: c.createdAt || Date.now(),
      createdBy: c.ownerEmail,
      messages: c.messages || [],
    },
  ];
}

export function useAppState() {
  // ─── State ───────────────────────────────────────────────────────────
  const [clients, setClients] = useState<Client[]>([]);
  const [invites, setInvites] = useState<Record<string, TeamInvite>>({});
  const [reads, setReads] = useState<Record<string, number>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewClient, setShowNewClient] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [boardTab, setBoardTab] = useState<BoardTab>("canvas");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<PendingTeamInvite | null>(null);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [toast, setToast] = useState<ToastEntry | null>(null);
  const [clientInvites, setClientInvites] = useState<Record<string, ClientInvite>>({});
  const [clientSession, setClientSession] = useState<ClientSession | null>(null);
  const [pendingClientPortalInvite, setPendingClientPortalInvite] = useState<PendingClientInvite | null>(null);

  // ─── Initial load ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const w = window.storage;
        if (!w) {
          setLoading(false);
          return;
        }
        const [data, sess, inv, rs, ws, aws, ut, ci] = await Promise.all([
          w.get(STORAGE_KEY).catch(() => null),
          w.get(SESSION_KEY).catch(() => null),
          w.get(INVITES_KEY).catch(() => null),
          w.get(READSTATE_KEY).catch(() => null),
          w.get(WORKSPACES_KEY).catch(() => null),
          w.get(ACTIVE_WS_KEY).catch(() => null),
          w.get(USER_TEMPLATES_KEY).catch(() => null),
          w.get(CLIENT_INVITES_KEY).catch(() => null),
        ]);
        if (data?.value) setClients(JSON.parse(data.value));
        if (sess?.value) setSession(JSON.parse(sess.value));
        if (inv?.value) setInvites(JSON.parse(inv.value));
        if (rs?.value) setReads(JSON.parse(rs.value));
        if (ws?.value) setWorkspaces(JSON.parse(ws.value));
        if (aws?.value) setActiveWorkspaceId(JSON.parse(aws.value));
        if (ut?.value) setUserTemplates(JSON.parse(ut.value));
        if (ci?.value) setClientInvites(JSON.parse(ci.value));

        const params = new URLSearchParams(window.location.search);
        const token = params.get("invite");
        const clientToken = params.get("clientInvite");
        if (token && inv?.value) {
          const all = JSON.parse(inv.value) as Record<string, TeamInvite>;
          if (all[token] && !all[token].accepted) {
            setPendingInvite({ token, ...all[token] });
          }
        }
        if (clientToken && ci?.value) {
          const all = JSON.parse(ci.value) as Record<string, ClientInvite>;
          if (all[clientToken]) {
            setPendingClientPortalInvite({ token: clientToken, ...all[clientToken] });
          }
        }
      } catch {
        // Best-effort load; fall through to empty state.
      }
      setLoading(false);
    })();
  }, []);

  // ─── Persist helpers ─────────────────────────────────────────────────
  const persistClients = async (next: Client[]) => {
    setClients(next);
    try { await window.storage?.set(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };
  const persistSession = async (next: Session | null) => {
    setSession(next);
    try { await window.storage?.set(SESSION_KEY, JSON.stringify(next)); } catch {}
  };
  const persistInvites = async (next: Record<string, TeamInvite>) => {
    setInvites(next);
    try { await window.storage?.set(INVITES_KEY, JSON.stringify(next)); } catch {}
  };
  const persistReads = async (next: Record<string, number>) => {
    setReads(next);
    try { await window.storage?.set(READSTATE_KEY, JSON.stringify(next)); } catch {}
  };
  const persistWorkspaces = async (next: Workspace[]) => {
    setWorkspaces(next);
    try { await window.storage?.set(WORKSPACES_KEY, JSON.stringify(next)); } catch {}
  };
  const persistActiveWs = async (next: string | null) => {
    setActiveWorkspaceId(next);
    try { await window.storage?.set(ACTIVE_WS_KEY, JSON.stringify(next)); } catch {}
  };
  const persistUserTemplates = async (next: UserTemplate[]) => {
    setUserTemplates(next);
    try { await window.storage?.set(USER_TEMPLATES_KEY, JSON.stringify(next)); } catch {}
  };
  const persistClientInvites = async (next: Record<string, ClientInvite>) => {
    setClientInvites(next);
    try { await window.storage?.set(CLIENT_INVITES_KEY, JSON.stringify(next)); } catch {}
  };

  // ─── Toast ───────────────────────────────────────────────────────────
  const showToast = (message: string, type: "success" | "info" = "success") => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Client portal magic-link auth ───────────────────────────────────
  const inviteClientToPipeline = (clientId: string, clientEmail: string) => {
    if (!session || !clientEmail.trim()) return null;
    const cleanEmail = clientEmail.trim().toLowerCase();
    const token = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const next: Record<string, ClientInvite> = {
      ...clientInvites,
      [token]: {
        clientId,
        clientEmail: cleanEmail,
        agencyEmail: session.email,
        accepted: false,
        ts: Date.now(),
      },
    };
    persistClientInvites(next);

    const target = clients.find((c) => c.id === clientId);
    if (target) {
      const channels = target.channels || [];
      const hasClientChannel = channels.some((ch) => ch.isClient);
      if (!hasClientChannel) {
        const baseName = (target.name || "client")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "client";
        const newChannel: Channel = {
          id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: baseName,
          isClient: true,
          memberEmails: Array.from(new Set([target.ownerEmail, cleanEmail])),
          createdAt: Date.now(),
          createdBy: target.ownerEmail,
          messages: [],
        };
        updateClient(clientId, (c) => ({
          ...c,
          channels: [...(c.channels || []), newChannel],
        }));
      } else {
        updateClient(clientId, (c) => ({
          ...c,
          channels: (c.channels || []).map((ch) =>
            ch.isClient
              ? { ...ch, memberEmails: Array.from(new Set([...(ch.memberEmails || []), cleanEmail])) }
              : ch,
          ),
        }));
      }
    }

    const link = `${window.location.origin}${window.location.pathname}?clientInvite=${token}`;
    return { token, link };
  };

  const revokeClientInvite = (token: string) => {
    const next = { ...clientInvites };
    delete next[token];
    persistClientInvites(next);
  };

  const acceptClientPortalInvite = () => {
    if (!pendingClientPortalInvite) return;
    const { token, clientEmail, clientId } = pendingClientPortalInvite;
    setClientSession({ email: clientEmail, clientId, role: "client", token });
    persistClientInvites({
      ...clientInvites,
      [token]: { ...clientInvites[token], accepted: true, acceptedAt: Date.now() },
    });
    setPendingClientPortalInvite(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("clientInvite");
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  const handleClientLogout = () => {
    setClientSession(null);
  };

  const clientPipeline = clientSession
    ? clients.find((c) => c.id === clientSession.clientId)
    : null;

  // ─── User templates ──────────────────────────────────────────────────
  const saveAsTemplate = (clientId: string, templateName: string, includeTasks: boolean) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c || !templateName.trim() || !session) return;
    const template: UserTemplate = {
      id: `ut_${Date.now()}`,
      name: templateName.trim(),
      icon: c.emoji || "📋",
      description: `Saved from ${c.name}`,
      ownerEmail: session.email,
      createdAt: Date.now(),
      stages: c.stages.map((s) => ({
        name: s.name,
        tasks: includeTasks ? s.tasks.map((t) => t.text) : [],
      })),
    };
    persistUserTemplates([...userTemplates, template]);
    showToast(`Saved "${template.name}" to your templates`);
    setShowSaveTemplateModal(false);
  };

  const deleteUserTemplate = (templateId: string) => {
    persistUserTemplates(userTemplates.filter((t) => t.id !== templateId));
  };

  // ─── Auth ────────────────────────────────────────────────────────────
  const handleLogin = (email: string, asOwner: boolean) =>
    persistSession({ email: email.trim().toLowerCase(), role: asOwner ? "owner" : "member" });

  const handleLogout = () => {
    persistSession(null);
    setActiveClientId(null);
    setActiveStageId(null);
  };

  // Workspace bootstrap — owner with no workspace gets a default one.
  useEffect(() => {
    if (!session || session.role !== "owner") return;
    const myWorkspaces = workspaces.filter((w) => w.ownerEmail === session.email);
    if (myWorkspaces.length === 0) {
      const defaultWs: Workspace = {
        id: `ws_${Date.now()}`,
        name: "My Workspace",
        ownerEmail: session.email,
        createdAt: Date.now(),
      };
      persistWorkspaces([...workspaces, defaultWs]);
      persistActiveWs(defaultWs.id);
      const needsMigration = clients.some((c) => c.ownerEmail === session.email && !c.workspaceId);
      if (needsMigration) {
        persistClients(
          clients.map((c) =>
            c.ownerEmail === session.email && !c.workspaceId
              ? { ...c, workspaceId: defaultWs.id }
              : c,
          ),
        );
      }
    } else if (!activeWorkspaceId || !myWorkspaces.find((w) => w.id === activeWorkspaceId)) {
      persistActiveWs(myWorkspaces[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email, workspaces.length]);

  // ─── Workspace CRUD ──────────────────────────────────────────────────
  const createWorkspace = (name: string): string | null => {
    if (!session) return null;
    const ws: Workspace = {
      id: `ws_${Date.now()}`,
      name: name.trim(),
      ownerEmail: session.email,
      createdAt: Date.now(),
    };
    persistWorkspaces([...workspaces, ws]);
    persistActiveWs(ws.id);
    return ws.id;
  };

  const renameWorkspace = (wsId: string, newName: string) => {
    persistWorkspaces(
      workspaces.map((w) => (w.id === wsId ? { ...w, name: newName.trim() } : w)),
    );
  };

  const deleteWorkspace = (wsId: string) => {
    if (!session) return;
    const myWs = workspaces.filter((w) => w.ownerEmail === session.email);
    if (myWs.length <= 1) return;
    persistClients(clients.filter((c) => c.workspaceId !== wsId));
    const remaining = workspaces.filter((w) => w.id !== wsId);
    persistWorkspaces(remaining);
    if (activeWorkspaceId === wsId) {
      const nextActive = remaining.find((w) => w.ownerEmail === session.email);
      persistActiveWs(nextActive?.id || null);
    }
  };

  const switchWorkspace = (wsId: string) => {
    persistActiveWs(wsId);
    setActiveClientId(null);
    setActiveStageId(null);
  };

  // ─── Team invites (agency-side) ──────────────────────────────────────
  const acceptInvite = (token: string, email: string) => {
    const inv = invites[token];
    if (!inv) return;
    persistInvites({ ...invites, [token]: { ...inv, accepted: true, acceptedEmail: email.trim().toLowerCase() } });
    const client = clients.find((c) => c.id === inv.clientId);
    if (client) {
      const members = client.members || [];
      const cleanEmail = email.trim().toLowerCase();
      if (!members.find((m) => m.email === cleanEmail)) {
        const updated = clients.map((c) =>
          c.id === inv.clientId
            ? withActivity(
                {
                  ...c,
                  members: [...members, { email: cleanEmail, joinedAt: Date.now(), role: "member", canSubmit: false }],
                },
                { type: "member_joined", who: cleanEmail },
              )
            : c,
        );
        persistClients(updated);
      }
    }
    persistSession({ email: email.trim().toLowerCase(), role: "member" });
    setPendingInvite(null);
    window.history.replaceState({}, "", window.location.pathname);
  };

  const createInvite = (clientId: string, email: string) => {
    const token = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!session) return token;
    persistInvites({
      ...invites,
      [token]: {
        clientId,
        email: email.trim().toLowerCase(),
        invitedBy: session.email,
        createdAt: Date.now(),
        accepted: false,
      },
    });
    return token;
  };

  // ─── Visible / filtered clients ──────────────────────────────────────
  const visibleClients = clients.filter((c) => {
    if (!session) return false;
    if (session.role === "owner") {
      const ownsInActiveWs = c.ownerEmail === session.email && c.workspaceId === activeWorkspaceId;
      const isMember = (c.members || []).some((m) => m.email === session.email);
      return ownsInActiveWs || isMember;
    }
    return (c.members || []).some((m) => m.email === session.email);
  });
  const filteredClients = visibleClients.filter((c) => {
    const q = searchQuery.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.company || "").toLowerCase().includes(q);
  });

  // ─── Client (pipeline) CRUD ──────────────────────────────────────────
  const createClient = (name: string, company: string, templateKey: string, emoji: string) => {
    if (!session) return;
    let stages: Stage[];
    if (typeof templateKey === "string" && templateKey.startsWith("ut_")) {
      const userTpl = userTemplates.find((t) => t.id === templateKey);
      stages = buildStages(null, userTpl ?? null);
    } else {
      stages = buildStages(templateKey);
    }
    const generalChannelId = `ch_${Date.now()}`;
    const newClient: Client = {
      id: `c_${Date.now()}`,
      name,
      company,
      emoji: emoji || "📋",
      ownerEmail: session.email,
      workspaceId: activeWorkspaceId,
      members: [],
      template: templateKey,
      createdAt: Date.now(),
      lastEdited: Date.now(),
      currentStage: stages[0].id,
      messages: [],
      links: [],
      activity: [{ id: `a_${Date.now()}`, type: "client_created", who: session.email, ts: Date.now() }],
      stages,
      channels: [
        {
          id: generalChannelId,
          name: "general",
          isClient: false,
          memberEmails: [session.email],
          createdAt: Date.now(),
          createdBy: session.email,
          messages: [],
        },
      ],
    };
    persistClients([newClient, ...clients]);
    setShowNewClient(false);
  };

  const deleteClient = (id: string) => persistClients(clients.filter((c) => c.id !== id));

  const updateClient = (clientId: string, updater: (c: Client) => Client) => {
    persistClients(
      clients.map((c) => (c.id === clientId ? { ...updater(c), lastEdited: Date.now() } : c)),
    );
  };

  // ─── Stage operations ────────────────────────────────────────────────
  const moveToStage = (clientId: string, stageId: string) =>
    updateClient(clientId, (c) => {
      const idx = c.stages.findIndex((s) => s.id === stageId);
      return {
        ...c,
        currentStage: stageId,
        stages: c.stages.map((s, i) =>
          i < idx
            ? { ...s, completed: true, completedAt: s.completedAt || Date.now() }
            : { ...s, completed: false, completedAt: null },
        ),
      };
    });

  const completeCurrentStage = (clientId: string) =>
    updateClient(clientId, (c) => {
      const idx = c.stages.findIndex((s) => s.id === c.currentStage);
      if (idx === -1) return c;
      const stageName = c.stages[idx].name;
      const newStages = c.stages.map((s, i) =>
        i === idx ? { ...s, completed: true, completedAt: Date.now() } : s,
      );
      const next = c.stages[idx + 1];
      return withActivity(
        { ...c, stages: newStages, currentStage: next ? next.id : c.currentStage },
        { type: "stage_advanced", who: session?.email || "", stageName },
      );
    });

  const submitPipeline = (clientId: string) => {
    if (!session || session.role !== "owner") return;
    updateClient(clientId, (c) => {
      if (c.ownerEmail !== session.email) return c;
      const finalStages = c.stages.map((s) =>
        s.completed ? s : { ...s, completed: true, completedAt: Date.now() },
      );
      return withActivity(
        { ...c, stages: finalStages, submittedAt: Date.now(), submittedBy: session.email },
        { type: "pipeline_submitted", who: session.email },
      );
    });
    showToast("🎉 Pipeline submitted! Great work.");
  };

  const renameStage = (clientId: string, stageId: string, newName: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => (s.id === stageId ? { ...s, name: newName } : s)),
    }));

  const updateStageDescription = (clientId: string, stageId: string, description: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => (s.id === stageId ? { ...s, description } : s)),
    }));

  const setStageDeadline = (clientId: string, stageId: string, deadline: number | null) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => (s.id === stageId ? { ...s, deadline } : s)),
    }));

  const setTaskDeadline = (clientId: string, stageId: string, taskId: string, deadline: number | null) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId
          ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, deadline } : t)) }
          : s,
      ),
    }));

  // ─── Stage attachments ───────────────────────────────────────────────
  const addStageAttachment = (
    clientId: string,
    stageId: string,
    label: string,
    dataUrl: string,
    fileName: string,
    fileSize: number,
  ) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const att: StageAttachment = {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: label || fileName || "image",
          kind: "image",
          dataUrl,
          fileName,
          fileSize,
          addedBy: session?.email || "",
          ts: Date.now(),
          clientVisible: false,
        };
        return { ...s, attachments: [...(s.attachments || []), att] };
      }),
    }));

  const toggleStageAttachmentClientVisible = (clientId: string, stageId: string, attachmentId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId
          ? {
              ...s,
              attachments: (s.attachments || []).map((a) =>
                a.id === attachmentId ? { ...a, clientVisible: !a.clientVisible } : a,
              ),
            }
          : s,
      ),
    }));

  const removeStageAttachment = (clientId: string, stageId: string, attachmentId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId
          ? { ...s, attachments: (s.attachments || []).filter((a) => a.id !== attachmentId) }
          : s,
      ),
    }));

  // ─── Visibility toggles ──────────────────────────────────────────────
  const toggleStageClientVisible = (clientId: string, stageId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => (s.id === stageId ? { ...s, clientVisible: !s.clientVisible } : s)),
    }));

  const toggleTaskClientVisible = (clientId: string, stageId: string, taskId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId
          ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, clientVisible: !t.clientVisible } : t)) }
          : s,
      ),
    }));

  const toggleNoteClientVisible = (clientId: string, stageId: string, noteId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const arr = normalizeNotes(s.notes);
        return {
          ...s,
          notes: arr.map((n) => (n.id === noteId ? { ...n, clientVisible: !n.clientVisible } : n)),
        };
      }),
    }));

  // ─── Stage add/remove/reorder ────────────────────────────────────────
  const addStage = (clientId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: [
        ...c.stages,
        {
          id: `s_${Date.now()}`,
          name: `Stage ${c.stages.length + 1}`,
          description: "",
          deadline: null,
          color: pickColor(c.stages.length),
          completed: false,
          completedAt: null,
          notes: [],
          tasks: [],
        },
      ],
    }));

  const removeStage = (clientId: string, stageId: string) =>
    updateClient(clientId, (c) => {
      if (c.stages.length <= 1) return c;
      const newStages = c.stages.filter((s) => s.id !== stageId);
      return {
        ...c,
        stages: newStages,
        currentStage: c.currentStage === stageId ? newStages[0].id : c.currentStage,
      };
    });

  const reorderStage = (clientId: string, stageId: string, delta: number) =>
    updateClient(clientId, (c) => {
      const idx = c.stages.findIndex((s) => s.id === stageId);
      const newIdx = idx + delta;
      if (idx === -1 || newIdx < 0 || newIdx >= c.stages.length) return c;
      const stages = [...c.stages];
      const [moved] = stages.splice(idx, 1);
      stages.splice(newIdx, 0, moved);
      return { ...c, stages };
    });

  // ─── Task ops ────────────────────────────────────────────────────────
  const toggleTask = (clientId: string, stageId: string, taskId: string) =>
    updateClient(clientId, (c) => {
      const stagesAfter = c.stages.map((s) =>
        s.id === stageId
          ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
          : s,
      );
      const isCurrent = stageId === c.currentStage;
      const toggled = stagesAfter.find((s) => s.id === stageId)!;
      const allDone = toggled.tasks.length > 0 && toggled.tasks.every((t) => t.done);
      if (isCurrent && allDone) {
        const idx = stagesAfter.findIndex((s) => s.id === stageId);
        const finalStages = stagesAfter.map((s, i) =>
          i === idx ? { ...s, completed: true, completedAt: Date.now() } : s,
        );
        const next = stagesAfter[idx + 1];
        return withActivity(
          { ...c, stages: finalStages, currentStage: next ? next.id : c.currentStage },
          { type: "stage_advanced", who: session?.email || "", stageName: toggled.name },
        );
      }
      return { ...c, stages: stagesAfter };
    });

  const addTask = (clientId: string, stageId: string, text: string) => {
    if (!text.trim()) return;
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId
          ? {
              ...s,
              tasks: [
                ...s.tasks,
                { id: `t_${Date.now()}`, text: text.trim(), done: false, pos: null, deadline: null },
              ],
            }
          : s,
      ),
    }));
  };

  const removeTask = (clientId: string, stageId: string, taskId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId ? { ...s, tasks: s.tasks.filter((t) => t.id !== taskId) } : s,
      ),
    }));

  const reorderTask = (clientId: string, stageId: string, taskId: string, newIndex: number) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const oldIdx = s.tasks.findIndex((t) => t.id === taskId);
        if (oldIdx === -1) return s;
        const target = Math.max(0, Math.min(s.tasks.length - 1, newIndex));
        if (target === oldIdx) return s;
        const next = [...s.tasks];
        const [moved] = next.splice(oldIdx, 1);
        next.splice(target, 0, moved);
        // Reset explicit canvas positions so the canvas re-renders in array order.
        return { ...s, tasks: next.map((t) => ({ ...t, pos: null })) };
      }),
    }));

  const setTaskNote = (clientId: string, stageId: string, taskId: string, note: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) =>
        s.id === stageId
          ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, note } : t)) }
          : s,
      ),
    }));

  const updateTaskPosition = (
    clientId: string,
    stageId: string,
    taskId: string,
    pos: TaskPosition,
  ) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const updated = s.tasks.map((t) => (t.id === taskId ? { ...t, pos } : t));
        // Re-sort by Y position so the stage list reflects visual canvas order.
        const indexed = updated.map((t, idx) => ({ t, idx }));
        indexed.sort((a, b) => {
          const ay = a.t.pos?.y;
          const by = b.t.pos?.y;
          const aKey = typeof ay === "number" ? ay : Infinity;
          const bKey = typeof by === "number" ? by : Infinity;
          if (aKey !== bKey) return aKey - bKey;
          return a.idx - b.idx;
        });
        return { ...s, tasks: indexed.map((x) => x.t) };
      }),
    }));

  // ─── Stage notes ─────────────────────────────────────────────────────
  const addNote = (clientId: string, stageId: string, text: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const existing = normalizeNotes(s.notes);
        const trimmed = (text || "").trim();
        if (!trimmed) return s;
        const newNote: StageNote = {
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          text: trimmed,
          author: session?.email || "unknown",
          ts: Date.now(),
        };
        return { ...s, notes: [...existing, newNote] };
      }),
    }));

  const editNote = (clientId: string, stageId: string, noteId: string, newText: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const existing = normalizeNotes(s.notes);
        return {
          ...s,
          notes: existing.map((n) =>
            n.id === noteId && n.author === session?.email
              ? { ...n, text: newText.trim(), editedAt: Date.now() }
              : n,
          ),
        };
      }),
    }));

  const deleteNote = (clientId: string, stageId: string, noteId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      stages: c.stages.map((s) => {
        if (s.id !== stageId) return s;
        const existing = normalizeNotes(s.notes);
        return { ...s, notes: existing.filter((n) => n.id !== noteId) };
      }),
    }));

  // ─── Legacy thread message (kept until full migration to channels) ───
  const sendMessage = (clientId: string, text: string) => {
    if (!text.trim() || !session) return;
    updateClient(clientId, (c) => ({
      ...c,
      messages: [
        ...(c.messages || []),
        { id: `m_${Date.now()}`, author: session.email, text: text.trim(), ts: Date.now(), mentions: [], internal: false },
      ],
    }));
  };

  // ─── Channels ────────────────────────────────────────────────────────
  const createChannel = (
    clientId: string,
    channelName: string,
    memberEmails: string[],
    isClient = false,
  ): string | null => {
    if (!channelName.trim() || !session) return null;
    if (isClient) {
      const target = clients.find((c) => c.id === clientId);
      if (target && (target.channels || []).some((ch) => ch.isClient)) {
        return null;
      }
    }
    const newCh: Channel = {
      id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: channelName.trim().toLowerCase().replace(/\s+/g, "-"),
      isClient,
      memberEmails: Array.from(new Set([session.email, ...(memberEmails || [])])),
      createdAt: Date.now(),
      createdBy: session.email,
      messages: [],
    };
    updateClient(clientId, (c) => ({
      ...c,
      channels: [...ensureChannels(c), newCh],
    }));
    return newCh.id;
  };

  const renameChannel = (clientId: string, channelId: string, newName: string) => {
    if (!newName.trim()) return;
    updateClient(clientId, (c) => ({
      ...c,
      channels: ensureChannels(c).map((ch) =>
        ch.id === channelId
          ? { ...ch, name: newName.trim().toLowerCase().replace(/\s+/g, "-") }
          : ch,
      ),
    }));
  };

  const deleteChannel = (clientId: string, channelId: string) => {
    updateClient(clientId, (c) => {
      const chs = ensureChannels(c);
      if (chs.length <= 1) return c;
      return { ...c, channels: chs.filter((ch) => ch.id !== channelId) };
    });
  };

  const addChannelMember = (clientId: string, channelId: string, email: string) => {
    if (!email) return;
    updateClient(clientId, (c) => ({
      ...c,
      channels: ensureChannels(c).map((ch) =>
        ch.id === channelId
          ? { ...ch, memberEmails: Array.from(new Set([...ch.memberEmails, email])) }
          : ch,
      ),
    }));
  };

  const removeChannelMember = (clientId: string, channelId: string, email: string) => {
    updateClient(clientId, (c) => ({
      ...c,
      channels: ensureChannels(c).map((ch) =>
        ch.id === channelId ? { ...ch, memberEmails: ch.memberEmails.filter((e) => e !== email) } : ch,
      ),
    }));
  };

  const sendChannelMessage = (
    clientId: string,
    channelId: string,
    text: string,
    mentions: string[] = [],
    internal = false,
  ) => {
    if (!text.trim() || !session) return;
    updateClient(clientId, (c) => ({
      ...c,
      channels: ensureChannels(c).map((ch) =>
        ch.id === channelId
          ? {
              ...ch,
              messages: [
                ...(ch.messages || []),
                {
                  id: `m_${Date.now()}`,
                  author: session.email,
                  text: text.trim(),
                  ts: Date.now(),
                  mentions: mentions || [],
                  internal: !!internal,
                },
              ],
            }
          : ch,
      ),
    }));
  };

  // Client-portal post: posts as the client, internal hard-coded to false.
  const sendClientChannelMessage = (channelId: string, text: string, mentions: string[] = []) => {
    if (!text.trim() || !clientSession) return;
    updateClient(clientSession.clientId, (c) => ({
      ...c,
      channels: ensureChannels(c).map((ch) =>
        ch.id === channelId
          ? {
              ...ch,
              messages: [
                ...(ch.messages || []),
                {
                  id: `m_${Date.now()}`,
                  author: clientSession.email,
                  text: text.trim(),
                  ts: Date.now(),
                  mentions: mentions || [],
                  internal: false,
                },
              ],
            }
          : ch,
      ),
    }));
  };

  // ─── Links / pipeline files ──────────────────────────────────────────
  const addLink = (clientId: string, label: string, url: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      links: [
        ...(c.links || []),
        {
          id: `l_${Date.now()}`,
          label: label.trim(),
          url: url.trim(),
          kind: "url",
          addedBy: session?.email || "",
          ts: Date.now(),
          clientVisible: false,
        },
      ],
    }));

  const addImage = (
    clientId: string,
    label: string,
    dataUrl: string,
    fileName: string,
    fileSize: number,
  ) =>
    updateClient(clientId, (c) => ({
      ...c,
      links: [
        ...(c.links || []),
        {
          id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: label || fileName || "image",
          kind: "image",
          dataUrl,
          fileName,
          fileSize,
          addedBy: session?.email || "",
          ts: Date.now(),
          clientVisible: false,
        },
      ],
    }));

  const toggleLinkClientVisible = (clientId: string, linkId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      links: (c.links || []).map((l) =>
        l.id === linkId ? { ...l, clientVisible: !l.clientVisible } : l,
      ),
    }));

  const removeLink = (clientId: string, linkId: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      links: (c.links || []).filter((l) => l.id !== linkId),
    }));

  // ─── Members & roles ─────────────────────────────────────────────────
  const removeMember = (clientId: string, email: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      members: (c.members || []).filter((m) => m.email !== email),
    }));

  const promoteToAdmin = (clientId: string, email: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      members: (c.members || []).map((m: Member) =>
        m.email === email ? { ...m, role: "admin" } : m,
      ),
    }));

  const demoteToMember = (clientId: string, email: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      members: (c.members || []).map((m: Member) =>
        m.email === email ? { ...m, role: "member", canSubmit: false } : m,
      ),
    }));

  const toggleAdminCanSubmit = (clientId: string, email: string) =>
    updateClient(clientId, (c) => ({
      ...c,
      members: (c.members || []).map((m: Member) =>
        m.email === email ? { ...m, canSubmit: !m.canSubmit } : m,
      ),
    }));

  // ─── Read state ──────────────────────────────────────────────────────
  const markRead = (clientId: string, tab: string) => {
    if (!session) return;
    const key = `${session.email}|${clientId}|${tab}`;
    persistReads({ ...reads, [key]: Date.now() });
  };

  const getLastRead = (clientId: string, tab: string): number => {
    if (!session) return 0;
    return reads[`${session.email}|${clientId}|${tab}`] || 0;
  };

  const hasSeenCelebration = (clientId: string): boolean => {
    if (!session) return true;
    return !!reads[`${session.email}|${clientId}|celebration`];
  };

  const markCelebrationSeen = (clientId: string) => {
    if (!session) return;
    const key = `${session.email}|${clientId}|celebration`;
    persistReads({ ...reads, [key]: Date.now() });
  };

  const computeUnread = (client: Client | undefined) => {
    if (!client || !session) return { thread: 0, members: 0, activity: 0 };
    const threadRead = getLastRead(client.id, "thread");
    const membersRead = getLastRead(client.id, "members");
    const activityRead = getLastRead(client.id, "activity");
    const threadUnread = (client.messages || []).filter(
      (m) => m.ts > threadRead && m.author !== session.email,
    ).length;
    const membersUnread = (client.members || []).filter(
      (m) => m.joinedAt > membersRead && m.email !== session.email,
    ).length;
    const activityUnread = (client.activity || []).filter(
      (a) => a.ts > activityRead && a.who !== session.email,
    ).length;
    return { thread: threadUnread, members: membersUnread, activity: activityUnread };
  };

  // ─── Computed values ─────────────────────────────────────────────────
  const activeClient = clients.find((c) => c.id === activeClientId);
  const activeStage = activeClient?.stages.find((s) => s.id === activeStageId);
  const pendingClientInvitesForActive = activeClient
    ? Object.entries(invites)
        .filter(([, inv]) => inv.clientId === activeClient.id && !inv.accepted)
        .map(([token, inv]) => ({ token, ...inv }))
    : [];

  // Mark current tab as read whenever it changes.
  useEffect(() => {
    if (activeClient && session) markRead(activeClient.id, boardTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClient?.id, boardTab, session?.email]);

  // Set browser tab title.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = activeClient ? `${activeClient.name} · Stages` : "Stages";
  }, [activeClient?.id, activeClient?.name]);

  return {
    // Loading / data
    loading,
    clients,
    workspaces,
    invites,
    clientInvites,
    reads,
    userTemplates,

    // Auth
    session,
    clientSession,
    pendingInvite,
    setPendingInvite,
    pendingClientPortalInvite,
    setPendingClientPortalInvite,
    handleLogin,
    handleLogout,
    acceptInvite,
    acceptClientPortalInvite,
    handleClientLogout,
    clientPipeline,

    // Active selection
    activeWorkspaceId,
    activeClientId,
    setActiveClientId,
    activeStageId,
    setActiveStageId,
    activeClient,
    activeStage,

    // Visible / filtered
    visibleClients,
    filteredClients,
    pendingClientInvitesForActive,

    // UI state
    showNewClient,
    setShowNewClient,
    searchQuery,
    setSearchQuery,
    boardTab,
    setBoardTab,
    showInviteModal,
    setShowInviteModal,
    showWorkspaceModal,
    setShowWorkspaceModal,
    showSaveTemplateModal,
    setShowSaveTemplateModal,
    toast,
    showToast,

    // Workspace
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    switchWorkspace,

    // Client invites (portal)
    inviteClientToPipeline,
    revokeClientInvite,

    // Templates
    saveAsTemplate,
    deleteUserTemplate,

    // Client CRUD
    createClient,
    deleteClient,
    updateClient,

    // Stage ops
    moveToStage,
    completeCurrentStage,
    submitPipeline,
    renameStage,
    updateStageDescription,
    setStageDeadline,
    setTaskDeadline,
    toggleStageClientVisible,
    toggleTaskClientVisible,
    toggleNoteClientVisible,
    addStage,
    removeStage,
    reorderStage,

    // Tasks
    toggleTask,
    addTask,
    removeTask,
    reorderTask,
    setTaskNote,
    updateTaskPosition,

    // Notes
    addNote,
    editNote,
    deleteNote,

    // Stage attachments
    addStageAttachment,
    toggleStageAttachmentClientVisible,
    removeStageAttachment,

    // Channels
    createChannel,
    renameChannel,
    deleteChannel,
    addChannelMember,
    removeChannelMember,
    sendChannelMessage,
    sendClientChannelMessage,
    sendMessage,

    // Links
    addLink,
    addImage,
    toggleLinkClientVisible,
    removeLink,

    // Members
    removeMember,
    promoteToAdmin,
    demoteToMember,
    toggleAdminCanSubmit,
    createInvite,

    // Read state
    markRead,
    getLastRead,
    hasSeenCelebration,
    markCelebrationSeen,
    computeUnread,
  };
}

export type AppState = ReturnType<typeof useAppState>;
