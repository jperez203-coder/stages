"use client";

import { cloneElement, isValidElement, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, Folder, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DOCUMENT_STARS_CHANGE_EVENT } from "@/lib/document-stars";
import {
  DOCUMENT_RENAMED_EVENT,
  notifyDocumentRenamed,
  type DocumentRenamedDetail,
} from "@/lib/document-title";
import {
  RECENT_DOCS_LIMIT,
  parseRecentDocIds,
  readRecentDocsRaw,
  recordRecentDoc,
  subscribeRecentDocs,
} from "@/lib/recent-docs";
import { DocIcon } from "@/components/icons/DocIcon";
import { SheetIcon } from "@/components/icons/SheetIcon";
import { SidebarHomeIcon } from "@/components/icons/SidebarHomeIcon";
import { SidebarActivityIcon } from "@/components/icons/SidebarActivityIcon";
import type { HeaderSearchPipeline } from "@/components/app/HeaderSearch";

/**
 * Persistent left sidebar — the Notion-style rail from Figma "Stages UI V2".
 * Mounted inside AppShell alongside the existing top header; this is new
 * layout surface, not a replacement for the header.
 *
 * SCOPE NOTE for this pass: the Figma also shows "Chat" and "Files" as
 * Home-level sidebar items. Today those only exist PER-PIPELINE
 * (/w/[slug]/p/[id]/chat, /files) — there's no cross-project chat inbox or
 * files view yet. Rather than ship dead links or fake functionality, this
 * component omits them until that's actually scoped. "Private" is hidden
 * for now (2026-09-25, not in use — see the comment where it rendered; no
 * private schema exists yet). Live sections (2026-09-25):
 *   - Recents: the last 5 docs/sheets this user opened in the workspace,
 *     stored per browser in localStorage (see lib/recent-docs.ts).
 *   - Starred: this user's starred docs/sheets from `document_stars`
 *     (per-user, synced across devices), newest star first.
 *
 * Projects list + custom folders/docs ARE fully functional:
 *   - Projects: reuses the SAME pipelines list AppShell already fetches for
 *     header search (passed down as a prop) — no duplicate query. RLS on
 *     `pipelines` (tightened 2026-09-05) already scopes this to exactly
 *     what the signed-in user can see, so no client-side filtering needed.
 *   - Folders/documents: fetched here directly from the new
 *     sidebar_folders/documents tables (workspace-wide, not pipeline-scoped
 *     — see 20260904120000_sidebar_folders_and_documents.sql).
 */

type SidebarFolder = {
  id: string;
  name: string;
  position: number;
};

type SidebarDocument = {
  id: string;
  folder_id: string;
  title: string;
  type: "doc" | "sheet";
};

type Props = {
  workspaceSlug: string | null;
  workspaceId: string | null;
  /** Signed-in user — scopes the per-browser Recents list. */
  userId: string | null;
  pipelines: HeaderSearchPipeline[];
};

const PROJECT_ICON_COLORS = ["#F59E0B", "#8B5CF6", "#3BA5EE", "#15B981", "#EC4899", "#F43F5E"];
function pickProjectColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return PROJECT_ICON_COLORS[Math.abs(hash) % PROJECT_ICON_COLORS.length];
}

export function Sidebar({ workspaceSlug, workspaceId, userId, pipelines }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const homeHref = workspaceSlug ? `/w/${workspaceSlug}` : "/";
  const activityHref = workspaceSlug ? `/w/${workspaceSlug}/activity` : "/";
  // Home is only "active" on the exact workspace root — every other
  // /w/[slug]/* route (tasks, activity, a pipeline, a doc) has its own
  // nav row (or none yet) and shouldn't leave Home looking selected.
  // Home covers its own sub-tabs too (Dashboard/Task/Projects/Clients —
  // see HomeTabs.tsx), so the sidebar row stays highlighted while on any
  // of them, not just the bare workspace root.
  const homeSubTabs = ["tasks", "projects", "clients"];
  const isHomeActive =
    pathname === homeHref || homeSubTabs.some((tab) => pathname === `${homeHref}/${tab}`);
  const isActivityActive = pathname === activityHref || (pathname?.startsWith(`${activityHref}/`) ?? false);
  const [folders, setFolders] = useState<SidebarFolder[]>([]);
  const [documents, setDocuments] = useState<SidebarDocument[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [openFolderMenu, setOpenFolderMenu] = useState<string | null>(null);
  const [openDocMenu, setOpenDocMenu] = useState<string | null>(null);
  // Folder id whose hover-"+" (new Doc / Sheet) menu is open.
  const [openAddMenu, setOpenAddMenu] = useState<string | null>(null);
  // Screen position for whichever row menu is open (see menuAnchorFor).
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [starredOpen, setStarredOpen] = useState(true);
  // Starred doc ids for this user + workspace, newest star first.
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [foldersOpen, setFoldersOpen] = useState(true);

  useEffect(() => {
    if (!openFolderMenu && !openDocMenu && !openAddMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-row-menu]")) {
        setOpenFolderMenu(null);
        setOpenDocMenu(null);
        setOpenAddMenu(null);
      }
    };
    // The menu is pinned to the screen, so if the sidebar scrolls or the
    // window resizes it would drift off its row — just close it.
    const closeAll = () => {
      setOpenFolderMenu(null);
      setOpenDocMenu(null);
      setOpenAddMenu(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("resize", closeAll);
    window.addEventListener("scroll", closeAll, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", closeAll);
      window.removeEventListener("scroll", closeAll, true);
    };
  }, [openFolderMenu, openDocMenu, openAddMenu]);
  const [newFolderName, setNewFolderName] = useState("");
  // Inline rename (folder "···" → Rename folder): which folder is being
  // edited, and the draft name.
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Same inline rename for docs/sheets (doc "···" → Rename).
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [docRenameDraft, setDocRenameDraft] = useState("");

  // Title edited on the doc page → update the sidebar row live.
  useEffect(() => {
    const onRenamed = (e: Event) => {
      const { id, title } = (e as CustomEvent<DocumentRenamedDetail>).detail;
      setDocuments((prev) => prev.map((d) => (d.id === id && d.title !== title ? { ...d, title } : d)));
    };
    window.addEventListener(DOCUMENT_RENAMED_EVENT, onRenamed);
    return () => window.removeEventListener(DOCUMENT_RENAMED_EVENT, onRenamed);
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setFolders([]);
      setDocuments([]);
      setLoadState("ready");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    void (async () => {
      const [foldersRes, documentsRes] = await Promise.all([
        supabase
          .from("sidebar_folders")
          .select("id, name, position")
          .eq("workspace_id", workspaceId)
          .order("position", { ascending: true }),
        supabase
          .from("documents")
          .select("id, folder_id, title, type")
          .eq("workspace_id", workspaceId),
      ]);
      if (cancelled) return;
      if (foldersRes.error || documentsRes.error) {
        console.error(
          "[sidebar] folders/documents fetch failed:",
          foldersRes.error?.message,
          documentsRes.error?.message,
        );
        setLoadState("error");
        return;
      }
      setFolders(foldersRes.data ?? []);
      setDocuments(documentsRes.data ?? []);
      // New workspaces start with every folder expanded — nothing to hide yet.
      setExpandedFolders(new Set((foldersRes.data ?? []).map((f) => f.id)));
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !workspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    const nextPosition = folders.length
      ? Math.max(...folders.map((f) => f.position)) + 1
      : 0;
    const { data, error } = await supabase
      .from("sidebar_folders")
      .insert({ workspace_id: workspaceId, name, position: nextPosition })
      .select("id, name, position")
      .single();
    if (error) {
      console.error("[sidebar] createFolder failed:", error.message);
    } else if (data) {
      setFolders((prev) => [...prev, data]);
      setExpandedFolders((prev) => new Set(prev).add(data.id));
    }
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const createDocument = async (folderId: string, type: "doc" | "sheet") => {
    if (!workspaceId) return;
    const defaultContent =
      type === "doc"
        ? { blocks: [{ id: crypto.randomUUID(), type: "p", text: "" }] }
        : { columns: ["Column 1", "Column 2"], rows: [] };
    const { data, error } = await supabase
      .from("documents")
      .insert({
        workspace_id: workspaceId,
        folder_id: folderId,
        title: "Untitled",
        type,
        content: defaultContent,
        // Author for the doc page byline. (Never set before 2026-09-26.)
        created_by: userId,
      })
      .select("id, folder_id, title, type")
      .single();
    if (error) {
      console.error("[sidebar] createDocument failed:", error.message);
      return;
    }
    setDocuments((prev) => [...prev, data]);
    if (workspaceSlug) router.push(`/w/${workspaceSlug}/d/${data.id}`);
  };

  // Deleting a folder cascades to its documents at the DB level
  // (documents.folder_id references sidebar_folders(id) on delete cascade —
  // see 20260904120000_sidebar_folders_and_documents.sql), so the confirm
  // copy says so explicitly rather than silently losing docs.
  const startRenameFolder = (folder: SidebarFolder) => {
    setOpenFolderMenu(null);
    setRenamingFolderId(folder.id);
    setRenameDraft(folder.name);
  };

  // Enter/blur saves, Escape cancels. Empty or unchanged names just exit
  // edit mode. Optimistic: the new name shows immediately and is rolled
  // back if the update fails.
  const commitRenameFolder = async (folder: SidebarFolder) => {
    const name = renameDraft.trim();
    setRenamingFolderId(null);
    if (!name || name === folder.name) return;
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name } : f)));
    const { error } = await supabase.from("sidebar_folders").update({ name }).eq("id", folder.id);
    if (error) {
      console.error("[sidebar] renameFolder failed:", error.message);
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name: folder.name } : f)));
    }
  };

  const startRenameDocument = (doc: SidebarDocument) => {
    setOpenDocMenu(null);
    setRenamingDocId(doc.id);
    setDocRenameDraft(doc.title);
  };

  // Same rules as folder rename: Enter/blur saves, Escape cancels, empty or
  // unchanged exits; optimistic with rollback. notifyDocumentRenamed keeps
  // an open doc page's title input in sync.
  const commitRenameDocument = async (doc: SidebarDocument) => {
    const title = docRenameDraft.trim();
    setRenamingDocId(null);
    if (!title || title === doc.title) return;
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, title } : d)));
    const { error } = await supabase.from("documents").update({ title }).eq("id", doc.id);
    if (error) {
      console.error("[sidebar] renameDocument failed:", error.message);
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, title: doc.title } : d)));
      return;
    }
    notifyDocumentRenamed(doc.id, title);
  };

  const deleteFolder = async (folder: SidebarFolder) => {
    setOpenFolderMenu(null);
    const docCount = documents.filter((d) => d.folder_id === folder.id).length;
    const warning =
      docCount > 0
        ? `Delete "${folder.name}"? This will also delete the ${docCount} doc${docCount === 1 ? "" : "s"} inside it. This cannot be undone.`
        : `Delete "${folder.name}"? This cannot be undone.`;
    if (!confirm(warning)) return;
    const { error } = await supabase.from("sidebar_folders").delete().eq("id", folder.id);
    if (error) {
      console.error("[sidebar] deleteFolder failed:", error.message);
      return;
    }
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    setDocuments((prev) => prev.filter((d) => d.folder_id !== folder.id));
  };

  const deleteDocument = async (doc: SidebarDocument) => {
    setOpenDocMenu(null);
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      console.error("[sidebar] deleteDocument failed:", error.message);
      return;
    }
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  };

  // ── Recents ─────────────────────────────────────────────────────────
  // Opening a doc/sheet page records it (see lib/recent-docs.ts); the list
  // renders from the live `documents` state so titles stay current and
  // deleted docs drop out.
  const openedDocId = useMemo(() => {
    if (!workspaceSlug || !pathname) return null;
    const prefix = `/w/${workspaceSlug}/d/`;
    if (!pathname.startsWith(prefix)) return null;
    return pathname.slice(prefix.length).split("/")[0] || null;
  }, [pathname, workspaceSlug]);
  useEffect(() => {
    if (openedDocId && userId && workspaceId) recordRecentDoc(userId, workspaceId, openedDocId);
  }, [openedDocId, userId, workspaceId]);
  const recentsRaw = useSyncExternalStore(
    subscribeRecentDocs,
    () => readRecentDocsRaw(userId, workspaceId),
    () => "",
  );
  // ── Starred ─────────────────────────────────────────────────────────
  // Per-user stars from `document_stars` (RLS: a user only sees their
  // own). Re-fetched whenever the doc page's star toggle fires
  // DOCUMENT_STARS_CHANGE_EVENT, so starring shows up here instantly.
  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("document_stars")
        .select("document_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("[sidebar] starred fetch failed:", error.message);
        setStarredIds([]);
        return;
      }
      setStarredIds((data ?? []).map((r) => r.document_id as string));
    };
    void load();
    const onChange = () => void load();
    window.addEventListener(DOCUMENT_STARS_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(DOCUMENT_STARS_CHANGE_EVENT, onChange);
    };
  }, [workspaceId, userId]);
  const starredDocs = useMemo(() => {
    const byId = new Map(documents.map((d) => [d.id, d]));
    return starredIds.map((id) => byId.get(id)).filter((d): d is SidebarDocument => !!d);
  }, [starredIds, documents]);

  const recentDocs = useMemo(() => {
    const byId = new Map(documents.map((d) => [d.id, d]));
    return parseRecentDocIds(recentsRaw)
      .map((id) => byId.get(id))
      .filter((d): d is SidebarDocument => !!d)
      .slice(0, RECENT_DOCS_LIMIT);
  }, [recentsRaw, documents]);

  // Plain link row for a doc/sheet — shared by Recents and Starred.
  const renderDocLinkRow = (doc: SidebarDocument) => {
    const docHref = workspaceSlug ? `/w/${workspaceSlug}/d/${doc.id}` : "#";
    const isDocActive = pathname === docHref;
    return (
      <Link key={doc.id} href={docHref} className={ROW_CLASS} style={rowStyle(isDocActive, true)}>
        <IconBox>
          {doc.type === "doc" ? <DocIcon size={16} /> : <SheetIcon size={16} />}
        </IconBox>
        <RowLabel active={isDocActive} >{doc.title || "Untitled"}</RowLabel>
      </Link>
    );
  };

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-y-auto font-system"
      style={{
        width: 236,
        background: SB.bg,
        borderRight: `1px solid ${SB.border}`,
        padding: "8px 8px 16px 8px",
        lineHeight: "20px",
      }}
    >
      <div className="flex flex-col">
        <NavRow
          icon={<SidebarHomeIcon size={14} />}
          label="Home"
          href={homeHref}
          active={isHomeActive}
        />
        <NavRow
          icon={<SidebarActivityIcon size={14} />}
          label="Activity"
          href={activityHref}
          active={isActivityActive}
          // The bell glyph sits optically high next to the label.
          iconOffsetY={1}
        />
      </div>

      <SectionHeader label="Recents" open={recentsOpen} onToggle={() => setRecentsOpen((prev) => !prev)} />
      {recentsOpen && loadState === "ready" && (recentDocs.length === 0 ? (
        <EmptyRow>Docs you open show up here</EmptyRow>
      ) : (
        recentDocs.map(renderDocLinkRow)
      ))}
      <SectionHeader
        label="Starred"
        open={starredOpen}
        onToggle={() => setStarredOpen((prev) => !prev)}
        marginTop={recentsOpen ? 14 : 0}
      />
      {/* No empty-state row — with nothing starred, the header just sits
          in the tight Recents/Starred/Private group. */}
      {starredOpen && loadState === "ready" && starredDocs.map(renderDocLinkRow)}
      {/* "Private" section hidden for now (2026-09-25) — not in use yet.
          It was only ever a static label (no schema behind it); to bring
          it back, restore:
            <SectionHeader label="Private" marginTop={starredOpen && starredDocs.length > 0 ? 14 : 0} /> */}

      <SectionHeader label="Projects" open={projectsOpen} onToggle={() => setProjectsOpen((prev) => !prev)} />
      {projectsOpen && (pipelines.length === 0 ? (
        <EmptyRow>No projects yet</EmptyRow>
      ) : (
        pipelines.map((p) => {
          const projectHref = workspaceSlug ? `/w/${workspaceSlug}/p/${p.id}` : "#";
          const isProjectActive = pathname === projectHref || (pathname?.startsWith(`${projectHref}/`) ?? false);
          return (
            <Link
              key={p.id}
              href={projectHref}
              className={ROW_CLASS}
              style={rowStyle(isProjectActive)}
            >
              <IconBox>
                {p.emoji ? (
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{p.emoji}</span>
                ) : (
                  <span
                    aria-hidden
                    style={{ width: 8, height: 8, borderRadius: "50%", background: pickProjectColor(p.id) }}
                  />
                )}
              </IconBox>
              <RowLabel active={isProjectActive} >{p.name}</RowLabel>
            </Link>
          );
        })
      ))}

      <SectionHeader
        label="Folders"
        open={foldersOpen}
        onToggle={() => setFoldersOpen((prev) => !prev)}
        onAdd={() => {
          setFoldersOpen(true);
          setCreatingFolder(true);
        }}
        addLabel="New folder"
      />

      {creatingFolder && (
        <input
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onBlur={createFolder}
          onKeyDown={(e) => {
            if (e.key === "Enter") createFolder();
            if (e.key === "Escape") {
              setCreatingFolder(false);
              setNewFolderName("");
            }
          }}
          placeholder="Folder name"
          className="text-[14px] outline-none"
          style={{
            margin: "2px 0 4px 0",
            height: 30,
            padding: "0 8px",
            background: "#2A2A2A",
            border: "1px solid #108CE9",
            borderRadius: 6,
            color: SB.text,
          }}
        />
      )}

      {foldersOpen && loadState === "error" && (
        <EmptyRow color="#F43F5E">Couldn&apos;t load folders</EmptyRow>
      )}

      {foldersOpen && folders.map((folder) => {
        const isOpen = expandedFolders.has(folder.id);
        const folderDocs = documents.filter((d) => d.folder_id === folder.id);
        return (
          // An open folder gets extra space below its docs so it reads as
          // its own group; closed folders stay stacked at normal row pitch.
          <div key={folder.id} style={isOpen ? { marginBottom: 10 } : undefined}>
            <div
              data-row-menu
              className={`group relative ${ROW_CLASS}`}
              style={rowStyle(false)}
            >
              {renamingFolderId === folder.id ? (
                <div className="flex-1 flex items-center gap-2 min-w-0 h-full">
                  <IconBox>
                    <Folder size={17} color={SB.folder} fill={SB.folder} strokeWidth={1.5} />
                  </IconBox>
                  <RenameInput
                    value={renameDraft}
                    onChange={setRenameDraft}
                    onCommit={() => commitRenameFolder(folder)}
                    onCancel={() => setRenamingFolderId(null)}
                    label="Folder name"
                  />
                </div>
              ) : (
              <button
                type="button"
                onClick={() => toggleFolder(folder.id)}
                className={`flex-1 flex items-center gap-2 text-left min-w-0 h-full ${
                  openAddMenu === folder.id || openFolderMenu === folder.id ? "pr-[48px]" : "group-hover:pr-[48px]"
                }`}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                aria-expanded={isOpen}
              >
                {/* Notion pattern: the folder icon swaps to a toggle chevron
                    while the row is hovered. */}
                <IconBox>
                  <span className="group-hover:hidden flex">
                    <Folder size={17} color={SB.folder} fill={SB.folder} strokeWidth={1.5} />
                  </span>
                  <span className="hidden group-hover:flex">
                    <ChevronRight
                      size={16}
                      color={SB.icon}
                      strokeWidth={2}
                      style={{ transform: isOpen ? "rotate(90deg)" : undefined, transition: "transform 120ms" }}
                    />
                  </span>
                </IconBox>
                {/* Rendered exactly as typed — no forced casing. */}
                <RowLabel>{folder.name}</RowLabel>
              </button>
              )}
              {/* Hover "+" — the only way to add a Doc/Sheet to a folder
                  (replaced the inline "+ Doc / + Sheet" row, 2026-09-25). */}
              {renamingFolderId !== folder.id && (
              <HoverActions pinned={openAddMenu === folder.id || openFolderMenu === folder.id}>
              <RowMenuButton
                open={openAddMenu === folder.id}
                title="Add a doc or sheet"
                icon={<Plus size={16} strokeWidth={2} />}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenFolderMenu(null);
                  setMenuAnchor(menuAnchorFor(e.currentTarget));
                  setOpenAddMenu((prev) => (prev === folder.id ? null : folder.id));
                }}
              />
              <RowMenuButton
                open={openFolderMenu === folder.id}
                title="Folder options"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenAddMenu(null);
                  setMenuAnchor(menuAnchorFor(e.currentTarget));
                  setOpenFolderMenu((prev) => (prev === folder.id ? null : folder.id));
                }}
              />
              </HoverActions>
              )}
              {openAddMenu === folder.id && (
                <RowMenu anchor={menuAnchor}>
                  {(["doc", "sheet"] as const).map((type) => (
                    <RowMenuItem
                      key={type}
                      color={SB.text}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenAddMenu(null);
                        setExpandedFolders((prev) => new Set(prev).add(folder.id));
                        createDocument(folder.id, type);
                      }}
                    >
                      {type === "doc" ? <DocIcon size={16} /> : <SheetIcon size={16} />}
                      {type === "doc" ? "Doc" : "Sheet"}
                    </RowMenuItem>
                  ))}
                </RowMenu>
              )}
              {openFolderMenu === folder.id && (
                <RowMenu anchor={menuAnchor}>
                  <RowMenuItem
                    color={SB.text}
                    onClick={(e) => {
                      e.stopPropagation();
                      startRenameFolder(folder);
                    }}
                  >
                    <Pencil size={14} />
                    Rename folder
                  </RowMenuItem>
                  <RowMenuItem
                    color={SB.text}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFolder(folder);
                    }}
                  >
                    <Trash2 size={14} />
                    Delete folder
                  </RowMenuItem>
                </RowMenu>
              )}
            </div>
            {isOpen && (
              // Docs/sheets indent under their open folder so the group
              // reads as nested.
              <div style={{ paddingLeft: 8 }}>
                {folderDocs.map((doc) => {
                  const docHref = workspaceSlug ? `/w/${workspaceSlug}/d/${doc.id}` : "#";
                  const isDocActive = pathname === docHref;
                  return (
                    <div
                      key={doc.id}
                      data-row-menu
                      className={`group relative ${ROW_CLASS}`}
                      style={rowStyle(isDocActive, true)}
                    >
                      {renamingDocId === doc.id ? (
                        <div className="flex-1 flex items-center gap-2 min-w-0 h-full">
                          <IconBox>
                            {doc.type === "doc" ? <DocIcon size={16} /> : <SheetIcon size={16} />}
                          </IconBox>
                          <RenameInput
                            value={docRenameDraft}
                            onChange={setDocRenameDraft}
                            onCommit={() => commitRenameDocument(doc)}
                            onCancel={() => setRenamingDocId(null)}
                            label="Document name"
                          />
                        </div>
                      ) : (
                      <Link
                        href={docHref}
                        className={`flex-1 flex items-center gap-2 min-w-0 h-full ${
                          openDocMenu === doc.id ? "pr-[26px]" : "group-hover:pr-[26px]"
                        }`}
                      >
                        <IconBox>
                          {doc.type === "doc" ? (
                            <DocIcon size={16} className="flex-shrink-0" />
                          ) : (
                            <SheetIcon size={16} className="flex-shrink-0" />
                          )}
                        </IconBox>
                        <RowLabel active={isDocActive} >{doc.title || "Untitled"}</RowLabel>
                      </Link>
                      )}
                      {renamingDocId !== doc.id && (
                      <HoverActions pinned={openDocMenu === doc.id}>
                        <RowMenuButton
                          open={openDocMenu === doc.id}
                          title="Document options"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setMenuAnchor(menuAnchorFor(e.currentTarget));
                            setOpenDocMenu((prev) => (prev === doc.id ? null : doc.id));
                          }}
                        />
                      </HoverActions>
                      )}
                      {openDocMenu === doc.id && (
                        <RowMenu anchor={menuAnchor}>
                          <RowMenuItem
                            color={SB.text}
                            onClick={(e) => {
                              e.stopPropagation();
                              startRenameDocument(doc);
                            }}
                          >
                            <Pencil size={14} />
                            Rename
                          </RowMenuItem>
                          <RowMenuItem
                            color={SB.text}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteDocument(doc);
                            }}
                          >
                            <Trash2 size={14} />
                            Delete
                          </RowMenuItem>
                        </RowMenu>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

/* ── Notion-style sidebar primitives ────────────────────────────────────
   Measured against Notion's dark sidebar: #202020 ground, 30px rows,
   22px icon box + 8px gap, 14px/500 labels, 12px/500 muted section
   headers, soft white-alpha hover/active fills, 6px radius. */
const SB = {
  bg: "#202020",
  border: "#2A2A2A",
  // Measured from a Notion sidebar screenshot (~#BEBEBE–#C1C1C1).
  text: "#C1C1C1",
  textActive: "#FFFFFF",
  icon: "#9B9B9B",
  muted: "#8A8A8A",
  folder: "#4A83E0",
  hover: "#333333",
  active: "rgba(255,255,255,0.085)",
};

const ROW_CLASS =
  "w-full flex items-center gap-2 rounded-md transition-colors hover:bg-[#333333]";

// 28px fill + 1px margin top/bottom: rows keep a 30px pitch, but adjacent
// hover/active fills always have a 2px gap instead of touching. Doc/sheet
// rows pass `spacious` for 2px margins (32px pitch) so file lists breathe.
function rowStyle(active: boolean, spacious = false): React.CSSProperties {
  return {
    height: 28,
    marginBlock: spacious ? 2 : 1,
    padding: "0 8px",
    flexShrink: 0,
    ...(active ? { background: SB.active } : null),
  };
}

/** `align="start"` left-aligns the glyph in its 22px box — used by
 *  Home/Activity so their icons' left edge lines up with the section
 *  labels (Recents, Starred…) below; the label text still starts at the
 *  same X as every other row. */
function IconBox({
  children,
  align = "center",
  width = 22,
}: {
  children: React.ReactNode;
  align?: "center" | "start";
  /** Home/Activity pass a narrow box so their label sits ~9px from the
   *  icon (instead of lining up with the rows' 22px icon column). */
  width?: number;
}) {
  return (
    <span
      className={`flex items-center flex-shrink-0 ${align === "start" ? "justify-start" : "justify-center"}`}
      style={{ width, height: 22 }}
    >
      {children}
    </span>
  );
}

/** Every sidebar row label: system UI font 14px / 500, active 600
 *  (switched from 600/700 on 2026-09-26). Section labels are separate
 *  (SectionHeader, 12px / 600) and unchanged.
 *  Tuned by eye by Jordan (2026-09-25). Notion's literal values (14px /
 *  500 with font-smoothing auto) were tried and looked worse — keep this. */
function RowLabel({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className="text-[14px] truncate"
      style={{
        fontWeight: active ? 600 : 500,
        color: active ? SB.textActive : SB.text,
      }}
    >
      {children}
    </span>
  );
}

function EmptyRow({ children, color = SB.muted }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[14px] flex items-center" style={{ height: 30, padding: "0 8px", color }}>
      {children}
    </div>
  );
}

/** Inline rename box for folder/doc rows. Enter or blur commits, Escape
 *  cancels; the current name is pre-selected. Escape unmounts the input
 *  before its blur fires, so a cancel never saves. */
function RenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  label: string;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onCancel();
      }}
      aria-label={label}
      className="flex-1 min-w-0 text-[14px] font-medium outline-none"
      style={{
        height: 24,
        padding: "0 6px",
        marginLeft: -6,
        background: "#2A2A2A",
        border: "1px solid #108CE9",
        borderRadius: 5,
        color: SB.text,
      }}
    />
  );
}

/** Row action buttons (+ / ···), overlaid at the row's right edge instead
 *  of sitting in the flex flow — so they take no width while hidden and
 *  the name can use the full row. The row's label adds matching right
 *  padding only while these are showing (hover, or a menu is open =
 *  `pinned`). */
function HoverActions({ pinned, children }: { pinned: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 items-center gap-0.5 ${pinned ? "flex" : "hidden group-hover:flex"}`}
      style={{ right: 4 }}
    >
      {children}
    </div>
  );
}

function RowMenuButton({
  open,
  title,
  onClick,
  icon = <MoreHorizontal size={16} />,
}: {
  open: boolean;
  title: string;
  icon?: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex items-center justify-center rounded flex-shrink-0 hover:bg-[rgba(255,255,255,0.08)] ${
        open ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"
      }`}
      style={{ width: 22, height: 22, border: "none", cursor: "pointer", color: SB.icon }}
    >
      {icon}
    </button>
  );
}

type MenuAnchor = { top: number; left: number };

/** Where a row's menu opens: just past the sidebar's right edge, top-
 *  aligned with the clicked row (Notion-style), so it sits beside the
 *  sidebar instead of on top of it. Clamped to stay on screen. */
function menuAnchorFor(button: HTMLElement): MenuAnchor | null {
  const row = button.closest("[data-row-menu]");
  const aside = button.closest("aside");
  if (!row || !aside) return null;
  const rowRect = row.getBoundingClientRect();
  const MENU_HEIGHT_ESTIMATE = 110;
  return {
    top: Math.max(8, Math.min(rowRect.top, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8)),
    left: aside.getBoundingClientRect().right + 6,
  };
}

/** Rendered into <body> (portal) with fixed positioning — the sidebar
 *  scrolls and AppShell clips its overflow, either of which would cut off
 *  a menu that extends past the sidebar's edge. `data-row-menu` keeps it
 *  inside the click-outside boundary. */
function RowMenu({ anchor, children }: { anchor: MenuAnchor | null; children: React.ReactNode }) {
  if (!anchor || typeof document === "undefined") return null;
  return createPortal(
    <div
      data-row-menu
      className="fixed z-50 rounded-md font-system"
      style={{
        top: anchor.top,
        left: anchor.left,
        lineHeight: "20px",
        background: "#252525",
        border: "1px solid #333333",
        minWidth: 160,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        padding: 4,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function RowMenuItem({
  children,
  onClick,
  color = "#F43F5E",
}: {
  children: React.ReactNode;
  /** Defaults to destructive red (Delete); pass SB.text for neutral items. */
  color?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Same type as the sidebar's row labels (14px / 500, system font via
      // RowMenu's font-system).
      className="w-full flex items-center gap-2 rounded text-left text-[14px] font-medium transition-colors hover:bg-[#333333]"
      style={{ height: 28, padding: "0 8px", border: "none", cursor: "pointer", color }}
    >
      {children}
    </button>
  );
}

function NavRow({
  icon,
  label,
  href,
  active,
  iconOffsetY = 0,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
  /** Optical nudge (px, positive = down) for glyphs that don't center well. */
  iconOffsetY?: number;
}) {
  // Icon color injected via cloneElement since `icon` arrives as an
  // already-built element — white on the active route, Notion's icon grey
  // otherwise.
  const tint = active ? SB.textActive : SB.icon;
  return (
    <Link href={href} className={ROW_CLASS} style={rowStyle(!!active)}>
      <IconBox align="start" width={15}>
        <span className="flex" style={iconOffsetY ? { transform: `translateY(${iconOffsetY}px)` } : undefined}>
          {isValidElement<{ color?: string }>(icon) ? cloneElement(icon, { color: tint }) : icon}
        </span>
      </IconBox>
      <RowLabel active={active} >{label}</RowLabel>
    </Link>
  );
}

/** Notion-style group label: small muted text aligned with the row icons,
 *  collapse chevron + optional "+" revealed on hover. Recents/Starred/
 *  Private pass no onToggle — they're still static, inert labels (no
 *  schema yet; see the header comment). */
function SectionHeader({
  label,
  open,
  onToggle,
  onAdd,
  addLabel,
  marginTop = 14,
}: {
  label: string;
  /** Space above the header. Starred/Private pass 0 so the three inert
   *  labels stack as one tight group under Recents. */
  marginTop?: number;
  open?: boolean;
  onToggle?: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div
      className="group flex items-center justify-between rounded-md transition-colors hover:bg-[#333333]"
      style={{ height: 30, padding: "0 8px", marginTop, flexShrink: 0 }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={onToggle ? open : undefined}
        className="flex-1 flex items-center gap-1 text-left min-w-0 h-full"
        style={{ background: "transparent", border: "none", cursor: onToggle ? "pointer" : "default", padding: 0 }}
      >
        <span className="text-[12px] font-semibold" style={{ color: SB.muted }}>
          {label}
        </span>
        {onToggle && (
          <ChevronRight
            size={13}
            color={SB.muted}
            strokeWidth={2.25}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          />
        )}
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="flex items-center justify-center rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[rgba(255,255,255,0.08)]"
          style={{ width: 22, height: 22, border: "none", cursor: "pointer", color: SB.icon }}
        >
          <Plus size={15} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
