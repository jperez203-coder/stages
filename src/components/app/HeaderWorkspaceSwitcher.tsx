"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { WorkspaceIcon } from "@/components/icons/WorkspaceIcon";
import { supabase } from "@/lib/supabase";
import type { UserContext } from "@/hooks/useUserContexts";

type Props = {
  /** All contexts the user has — both agency-side workspace memberships and
   *  pipeline-level memberships. Filtered + deduplicated below to one
   *  workspace entry per unique workspace, agency-side only. */
  contexts: UserContext[];
  /** Slug of the workspace currently in the URL (/w/[slug]). May be null
   *  if the user is on a route outside the /w/[slug] tree (shouldn't
   *  happen — AppShell is only mounted inside that tree — but defensive). */
  activeSlug: string | null;
  /** Current user's id, needed to write last_active_workspace_id. */
  userId: string;
};

/**
 * Workspace switcher in the AppShell header. Carries forward the legacy
 * WorkspaceSwitcher's affordances (rename, delete, create new) connected
 * to real Supabase mutations now.
 *
 *   * Switch:  click a row → write last_active_workspace_id, navigate to
 *              /w/[new-slug]. The page route remounts with the new slug.
 *   * Rename:  inline edit on the row, commits via UPDATE on workspaces.
 *              Only the `name` column changes — slug stays stable so URLs
 *              don't break (Notion/GitHub pattern).
 *   * Delete:  trash icon, confirms, runs DELETE on workspaces. Cascades
 *              to memberships/pipelines via FK. Disabled on the only
 *              remaining workspace (matches legacy guard).
 *   * Create:  routes to /onboarding/create-workspace stub (step 5
 *              builds the real form).
 *
 * Per the locked plan, only AGENCY contexts appear here — clients aren't
 * really "workspaces to switch between," they're pipeline-scoped views
 * that get a different navigation surface later. Multiple agency contexts
 * for the same workspace (e.g. user is workspace-owner AND pipeline-admin
 * of one specific pipeline in that workspace) collapse to one row.
 */
export function HeaderWorkspaceSwitcher({ contexts, activeSlug, userId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
        setEditValue("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Deduplicate to one entry per workspace, agency contexts only. When the
  // user has multiple agency contexts for the same workspace, prefer the
  // workspace-membership context (broader access) over the pipeline-level
  // one — same precedence as resolveDestination.ts.
  const workspaces = dedupeAgencyContexts(contexts);
  const active = workspaces.find((w) => w.workspaceSlug === activeSlug);
  const onlyOneWorkspace = workspaces.length <= 1;

  // Tier-A defense-in-depth (2026-05-26). AppShell already hides this
  // entire switcher when the caller has zero agency contexts (A1), so
  // in practice the "Create new workspace" item won't even render for
  // a pure client. But if a future refactor ever exposes the switcher
  // to a non-agency user via some other path, this local check stops
  // the dropdown from offering them the create-workspace affordance.
  // Independent of AppShell's gate by design — both layers evaluate to
  // the same answer for the same input, but neither relies on the other.
  const hasAnyAgencyContext = contexts.some((c) => c.type === "agency");

  const labelForButton = active?.workspaceName ?? "Workspace";

  const startEdit = (ctx: UserContext) => {
    setEditingId(ctx.workspaceId);
    setEditValue(ctx.workspaceName);
  };

  const commitEdit = async () => {
    if (!editingId || !editValue.trim()) {
      setEditingId(null);
      setEditValue("");
      return;
    }
    setBusyId(editingId);
    const newName = editValue.trim();
    // Only updating `name`. Slug stays stable so URLs don't break — same
    // pattern as Notion/GitHub. If we ever want "rename also changes slug,"
    // it'd be opt-in via a separate UI affordance.
    const { error } = await supabase
      .from("workspaces")
      .update({ name: newName })
      .eq("id", editingId);
    setBusyId(null);
    setEditingId(null);
    setEditValue("");
    if (error) {
      // Surface to the console for now. Toast UX comes in a later phase
      // (the in-memory app's Toast component lives below the AppShell).
      console.error("Workspace rename failed:", error.message);
      return;
    }
    // Refresh contexts on next render — easiest way is router.refresh() so
    // useUserContexts refetches. (Without this, the dropdown shows the
    // stale name until the user reloads.)
    router.refresh();
  };

  const switchTo = (ctx: UserContext) => {
    setOpen(false);
    // Persist last-active. Use .then() (NOT `void`) — supabase-js's
    // PostgrestBuilder is lazy: the HTTP request only fires once something
    // subscribes via await or .then(). `void` evaluates the builder and
    // discards it without subscribing, so the request never leaves the
    // browser. Bug originally caused Phase F writes to silently no-op.
    //
    // We don't await — last_active is a UX hint, not authoritative — so
    // the navigation isn't blocked on the write. But we do log on error
    // so future silent failures are visible in the console.
    // `.select()` returns the affected rows so we can detect silent denials
    // (0 rows + no error) — what RLS does when its USING clause excludes a
    // row. For this specific call path it's theoretically impossible (the
    // policy is `id = auth.uid()` and we pass our own userId), but the
    // warning catches future regressions if the policy ever tightens.
    supabase
      .from("profiles")
      .update({ last_active_workspace_id: ctx.workspaceId })
      .eq("id", userId)
      .select()
      .then(({ error, data }) => {
        if (error) {
          console.error(
            "Failed to persist last_active_workspace_id:",
            error.message,
          );
        } else if (!data || data.length === 0) {
          console.warn(
            "last_active_workspace_id update affected 0 rows — RLS denial or missing profile row?",
          );
        }
      });
    router.push(`/w/${ctx.workspaceSlug}`);
  };

  const deleteWorkspace = async (ctx: UserContext) => {
    if (
      !confirm(
        `Delete workspace "${ctx.workspaceName}"? All pipelines, members, and channels in this workspace will be removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(ctx.workspaceId);
    const { error } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", ctx.workspaceId);
    setBusyId(null);
    if (error) {
      console.error("Workspace delete failed:", error.message);
      return;
    }
    setOpen(false);
    // After deleting, push to /select-workspace so the post-login router
    // re-resolves where to send the user (probably their other workspace,
    // or /onboarding/create-workspace if this was their last).
    router.push("/select-workspace");
  };

  const createNew = () => {
    setOpen(false);
    router.push("/onboarding/create-workspace");
  };

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 transition-colors"
        style={{
          background: "#212124",
          border: "1px solid #36363A",
          borderRadius: "8px",
          padding: "0 12px",
          height: "36px",
          color: "#E4E4E7",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#28282C")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#212124")}
      >
        <WorkspaceIcon size={16} />
        <span className="text-[13px] font-semibold max-w-[160px] truncate">
          {labelForButton}
        </span>
        <ChevronDown
          size={12}
          className="text-zinc-500"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 fade-in z-50"
          style={{
            width: "300px",
            background: "#1A1A1A",
            border: "1px solid #36363A",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}
        >
          <div className="px-3 py-2.5 border-b border-zinc-800">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">
              Your workspaces
            </div>
          </div>

          <div className="py-1 max-h-[280px] overflow-y-auto scrollbar-thin">
            {workspaces.map((ctx) => {
              const isActive = ctx.workspaceSlug === activeSlug;
              const isEditing = editingId === ctx.workspaceId;
              const isBusy = busyId === ctx.workspaceId;
              return (
                <div key={ctx.workspaceId} className="px-2 group">
                  {isEditing ? (
                    <div className="flex items-center gap-2 px-2 py-2">
                      <WorkspaceIcon size={18} />
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditValue("");
                          }
                        }}
                        className="flex-1 text-[13px] font-medium"
                        style={{
                          background: "#212124",
                          border: "1px solid #108CE9",
                          borderRadius: "6px",
                          padding: "4px 8px",
                          color: "#E4E4E7",
                          outline: "none",
                        }}
                        disabled={isBusy}
                      />
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors"
                      style={{ background: isActive ? "#212124" : "transparent" }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "#1F1F22";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => switchTo(ctx)}
                    >
                      <WorkspaceIcon size={18} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {ctx.workspaceName}
                        </div>
                        <div className="text-[11px] text-zinc-500 capitalize mt-0.5">
                          {ctx.role}
                        </div>
                      </div>
                      {isActive && (
                        <Check
                          size={13}
                          className="flex-shrink-0"
                          style={{ color: "#3BA5EE" }}
                          strokeWidth={3}
                        />
                      )}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(ctx);
                          }}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200"
                          title="Rename"
                          disabled={isBusy}
                        >
                          <Pencil size={11} />
                        </button>
                        {!onlyOneWorkspace && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteWorkspace(ctx);
                            }}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-rose-400"
                            title="Delete workspace"
                            disabled={isBusy}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {workspaces.length === 0 && (
              <div className="px-4 py-3 text-[12px] text-zinc-600 text-center">
                No workspaces yet.
              </div>
            )}
          </div>

          {/* "Create new workspace" — gated on hasAnyAgencyContext as
              the second layer of the Tier-A boundary fix (2026-05-26).
              AppShell hides this whole switcher for pure clients (A1);
              this guard is the defense-in-depth pair (A3). */}
          {hasAnyAgencyContext && (
            <div className="border-t border-zinc-800 p-1">
              <button
                onClick={createNew}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1F1F22")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                style={{ background: "transparent" }}
              >
                <Plus size={14} strokeWidth={2.5} /> Create new workspace
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Deduplicate contexts to one entry per workspace, agency-side only. */
function dedupeAgencyContexts(contexts: UserContext[]): UserContext[] {
  const seen = new Map<string, UserContext>();
  for (const ctx of contexts) {
    if (ctx.type !== "agency") continue;
    const existing = seen.get(ctx.workspaceId);
    if (!existing) {
      seen.set(ctx.workspaceId, ctx);
      continue;
    }
    // Prefer workspace-source over pipeline-source (broader access wins) —
    // same precedence as resolveDestination.ts when contexts overlap.
    if (existing.source === "pipeline" && ctx.source === "workspace") {
      seen.set(ctx.workspaceId, ctx);
    }
  }
  return Array.from(seen.values());
}
