"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";

/**
 * TN-1: Task Notes section. Renders inside the task detail panel on
 * BOTH the agency canvas (TaskDetailPanel) and the portal
 * (PortalTaskDetailPanel). Same component, two host panels; the API
 * contract (create_task_note + delete_task_note RPCs) is symmetric
 * for agency and client surfaces, so a shared component is correct.
 *
 * Ordering — oldest at top, newest at bottom — places newer notes
 * adjacent to the input, matching the conversational read pattern
 * Jordan specified.
 *
 * Delete authz — UI mirrors the RPC: render the X only when the
 * viewer is the author OR has workspace owner/admin role. The RPC is
 * the authoritative floor; this is just to avoid showing affordances
 * that would 403.
 *
 * Realtime — none in v1. List refreshes on local mutation only
 * (create + delete). A future Tanstack Query / Supabase realtime
 * subscription belongs on WISHLIST, not here.
 */

type TaskNoteRow = {
  id: string;
  task_id: string;
  pipeline_id: string;
  workspace_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type AuthorProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type Props = {
  taskId: string;
  /** True if the viewer has workspace_memberships role in (owner, admin)
   *  on the parent workspace. Drives non-author delete affordance.
   *  The RPC re-checks this; this prop just gates the visible X.
   *  Conservatively false from both panels in TN-1 — threading the
   *  precise workspace-role signal is on WISHLIST. */
  viewerIsWorkspaceAdmin: boolean;
};

export function TaskNotesSection({
  taskId,
  viewerIsWorkspaceAdmin,
}: Props) {
  const session = useSession();
  const viewerId =
    session.status === "authenticated" ? session.user.id : null;

  const [notes, setNotes] = useState<TaskNoteRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AuthorProfile>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingContent, setPendingContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Lazy fetch ──────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    const { data, error } = await supabase
      .from("task_notes")
      .select(
        "id, task_id, pipeline_id, workspace_id, author_id, content, created_at, updated_at",
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(
        "[task-notes] fetch failed:",
        error.message,
        "code:",
        error.code,
      );
      setFetchError("Couldn't load notes.");
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as TaskNoteRow[];

    // Batch author profile fetch — same two-query pattern
    // TaskAttachmentsSection uses (author_id → auth.users; PostgREST
    // nested join from task_notes wouldn't traverse the FK to profiles
    // automatically).
    const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
    let profileMap: Record<string, AuthorProfile> = {};
    if (authorIds.length > 0) {
      const { data: profilesData, error: profilesErr } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url")
        .in("id", authorIds);
      if (profilesErr) {
        console.error(
          "[task-notes] profiles fetch failed:",
          profilesErr.message,
        );
        // Non-fatal: notes still render, with userId-derived avatar
        // and a "?" initial fallback.
      } else {
        profileMap = Object.fromEntries(
          (profilesData ?? []).map((p) => [p.id as string, p as AuthorProfile]),
        );
      }
    }

    setNotes(rows);
    setProfiles(profileMap);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  // ── Submit ─────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    const trimmed = pendingContent.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const sessionRes = await supabase.auth.getSession();
      const jwt = sessionRes.data.session?.access_token;
      if (!jwt) {
        setSubmitError("Your session expired. Refresh and try again.");
        return;
      }

      const res = await fetch("/api/task-notes/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ task_id: taskId, content: trimmed }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        setSubmitError(body?.message || body?.error || "Couldn't post note.");
        return;
      }

      const body = (await res.json()) as { ok: true; note: TaskNoteRow };
      const newNote = body.note;

      // Optimistic-but-refetched: append, then re-fetch in the background
      // so the author profile gets resolved if it wasn't already cached.
      setNotes((prev) => [...prev, newNote]);
      setPendingContent("");
      if (!profiles[newNote.author_id]) {
        // Fetch this single profile if not already cached.
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, display_name, email, avatar_url")
          .eq("id", newNote.author_id)
          .maybeSingle();
        if (profileData) {
          setProfiles((prev) => ({
            ...prev,
            [profileData.id as string]: profileData as AuthorProfile,
          }));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [pendingContent, taskId, profiles]);

  // ── Delete ─────────────────────────────────────────────────────────
  const confirmAndDelete = useCallback(
    async (noteId: string) => {
      setDeleting(true);
      try {
        const sessionRes = await supabase.auth.getSession();
        const jwt = sessionRes.data.session?.access_token;
        if (!jwt) return;

        const res = await fetch("/api/task-notes/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ note_id: noteId }),
        });

        if (!res.ok) {
          // Surface failure inline; keep the confirm modal open.
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          console.error("[task-notes] delete failed:", body?.error);
          return;
        }

        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        setConfirmDelete(null);
      } finally {
        setDeleting(false);
      }
    },
    [],
  );

  const canSubmit = pendingContent.trim().length > 0 && !submitting;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter on macOS, Ctrl+Enter on Windows/Linux.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit) void submit();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {fetchError && (
        <div
          style={{
            fontSize: 12,
            color: "#F87171",
            padding: "6px 8px",
            background: "rgba(248,113,113,0.08)",
            borderRadius: 6,
          }}
        >
          {fetchError}
        </div>
      )}

      {!loading && notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {notes.map((note) => {
            const profile = profiles[note.author_id];
            const canDelete =
              viewerId === note.author_id || viewerIsWorkspaceAdmin;
            return (
              <NoteCard
                key={note.id}
                note={note}
                profile={profile}
                canDelete={canDelete}
                onDelete={() => setConfirmDelete(note.id)}
              />
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: notes.length > 0 ? 4 : 0,
        }}
      >
        <textarea
          ref={textareaRef}
          value={pendingContent}
          onChange={(e) => {
            setPendingContent(e.target.value);
            if (submitError) setSubmitError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Insert text here…"
          rows={3}
          maxLength={5000}
          disabled={submitting}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 8,
            padding: "10px 12px",
            color: "white",
            fontSize: 13,
            fontFamily: "inherit",
            outline: "none",
            resize: "vertical",
            minHeight: 64,
          }}
        />

        {submitError && (
          <div style={{ fontSize: 12, color: "#F87171" }}>{submitError}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: canSubmit ? "#108CE9" : "rgba(255,255,255,0.06)",
              color: canSubmit ? "white" : "rgba(255,255,255,0.35)",
              border: "none",
              borderRadius: 6,
              cursor: canSubmit ? "pointer" : "not-allowed",
              transition: "background 120ms",
            }}
          >
            {submitting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDeleteModal
          deleting={deleting}
          onCancel={() => {
            if (!deleting) setConfirmDelete(null);
          }}
          onConfirm={() => void confirmAndDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

// ─── NoteCard ─────────────────────────────────────────────────────────

function NoteCard({
  note,
  profile,
  canDelete,
  onDelete,
}: {
  note: TaskNoteRow;
  profile: AuthorProfile | undefined;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);

  const { text: avatarText, bg: avatarBg } = getAvatarColorFromUserId(
    note.author_id,
  );
  const initial = profile
    ? resolveInitial({
        display_name: profile.display_name,
        email: profile.email ?? "",
      })
    : "?";
  const displayName =
    profile?.display_name?.trim() || profile?.email?.trim() || "Unknown";

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 8,
        position: "relative",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: avatarBg,
          color: avatarText,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            marginBottom: 2,
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.85)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.45,
          }}
        >
          {note.content}
        </div>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete note"
          tabIndex={0}
          style={{
            opacity: hovering || focused ? 1 : 0,
            transition: "opacity 120ms",
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            padding: 4,
            borderRadius: 4,
            alignSelf: "flex-start",
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ─── ConfirmDeleteModal ───────────────────────────────────────────────

function ConfirmDeleteModal({
  deleting,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Lightweight modal. Same pattern as PI-followup-3 confirm
  // (MembersBody RemoveConfirmModal) — fixed overlay, centered card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleting, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1A1A1C",
          border: "1px solid #36363A",
          borderRadius: 10,
          padding: 20,
          width: 340,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}
        >
          Delete this note?
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>
          This can&apos;t be undone.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              color: "rgba(255,255,255,0.85)",
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "#F43F5E",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "Deleting…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
