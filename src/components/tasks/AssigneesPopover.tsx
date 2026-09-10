"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Search, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import type { TaskAssignee } from "@/components/tasks/types";

/**
 * Assignee picker popover for the task detail panel's Assignees property
 * (Figma V2). Multi-select — clicking a row toggles that person on/off
 * `task_assignees` (additive alongside the legacy single `assignee_id`,
 * same as the rest of the Task tab — see
 * 20260906120000_task_priority_status_assignees.sql). No new RLS needed:
 * task_assignees_insert/delete already gate on can_edit_pipeline, matching
 * the canvas TaskDetailPanel's "Assignee — canEditPipeline only" rule.
 *
 * Assignable people = agency members of THIS TASK'S PIPELINE (role !=
 * 'client'), fetched lazily on open via pipeline_memberships + a batched
 * profiles lookup (no direct FK between the two tables for PostgREST to
 * embed, same reason tasks/page.tsx does its own two-step assignee fetch).
 * When pipelineId is null (a task created without a project — the hidden
 * "Unassigned" pipeline has no real memberships), this falls back to
 * workspace_memberships for workspaceId instead — the whole team, since
 * there's no narrower project to scope to.
 *
 * The "Search by name…" box only FILTERS this already-fetched member list
 * by display name (no email matching, per Jordan — this is a name picker,
 * not an invite box) — it does not send an invite. Real invite-by-email is
 * a separate, already-existing flow (Team settings / client invites) and
 * out of scope here.
 */

type Props = {
  anchor: HTMLElement | null;
  /** Null for a task with no project (the hidden "Unassigned" pipeline) —
   *  assignable people then come from workspaceId's whole team instead of
   *  one pipeline's members. */
  pipelineId: string | null;
  /** Used only as the fallback source when pipelineId is null. */
  workspaceId: string;
  /** Omit while drafting a not-yet-created task (CreateTaskModal) — there's
   *  no task_assignees row to write to yet, so toggle() only calls
   *  onChange() and the caller inserts the final selection itself once the
   *  real task id exists. */
  taskId?: string | null;
  currentAssignees: TaskAssignee[];
  onChange: (next: TaskAssignee[]) => void;
  onClose: () => void;
};

type Person = { id: string; displayName: string | null; email: string; avatarUrl: string | null };

const POPOVER_WIDTH = 260;
const POPOVER_HEIGHT = 320;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function AssigneesPopover({ anchor, pipelineId, workspaceId, taskId, currentAssignees, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());

  // POPOVER_HEIGHT is a rough upper bound (maxHeight on the popover
  // itself) — actual height is usually much shorter (few people, or a
  // short search result), so `compute` prefers the real measured height
  // once the popover has mounted, correcting the flip-up `top` rather
  // than leaving a big unwanted gap above the trigger.
  useLayoutEffect(() => {
    if (!anchor) return;
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const height = ref.current?.getBoundingClientRect().height ?? POPOVER_HEIGHT;
      const bottomIfBelow = a.bottom + GAP + height;
      const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
      const top = flipUp ? Math.max(VIEWPORT_PAD, a.top - GAP - height) : a.bottom + GAP;
      const left = Math.min(a.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD);
      setPosition((prev) => {
        const next = { top, left: Math.max(VIEWPORT_PAD, left) };
        if (prev && prev.top === next.top && prev.left === next.left) return prev;
        return next;
      });
    };
    compute();
    // Re-measure once mounted (first pass runs before the popover exists,
    // so it uses the POPOVER_HEIGHT guess) — this sees the real rendered
    // height and corrects the flip-up position if the guess was off.
    const raf = requestAnimationFrame(compute);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

  // The list's height changes as people load and as the search query
  // filters it — re-run the same measurement so a flipped-up popover
  // stays snug against the trigger instead of drifting as content
  // shrinks/grows.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const height = ref.current.getBoundingClientRect().height;
    const bottomIfBelow = a.bottom + GAP + height;
    const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
    const top = flipUp ? Math.max(VIEWPORT_PAD, a.top - GAP - height) : a.bottom + GAP;
    const left = Math.max(VIEWPORT_PAD, Math.min(a.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD));
    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, query]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (anchor && anchor.contains(e.target as Node)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A task without a project (the hidden per-workspace "Unassigned"
      // pipeline — see 20260910120000_unassigned_pipeline_for_tasks.sql)
      // has no pipeline_memberships to speak of, so assignable people
      // fall back to the whole workspace's team instead of one pipeline's.
      const membershipRes = pipelineId
        ? await supabase
            .from("pipeline_memberships")
            .select("user_id, role")
            .eq("pipeline_id", pipelineId)
            .neq("role", "client")
        : await supabase
            .from("workspace_memberships")
            .select("user_id, role")
            .eq("workspace_id", workspaceId);
      const { data: memberships, error: membershipErr } = membershipRes;
      if (cancelled) return;
      if (membershipErr) {
        console.error("[assignees] membership fetch failed:", membershipErr.message);
        setPeople([]);
        return;
      }
      const userIds = (memberships ?? []).map((m) => m.user_id);
      if (userIds.length === 0) {
        setPeople([]);
        return;
      }
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url")
        .in("id", userIds);
      if (cancelled) return;
      if (profilesErr) {
        console.error("[assignees] profiles fetch failed:", profilesErr.message);
        setPeople([]);
        return;
      }
      setPeople(
        (profiles ?? []).map((p) => ({
          id: p.id,
          displayName: p.display_name,
          email: p.email,
          avatarUrl: p.avatar_url,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId, workspaceId]);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    // Name-only match — per Jordan, this is a "type a name" picker, not an
    // invite-by-email box, so email never factors into the filter (even
    // though a person without a display_name still shows their email as
    // a last-resort label below).
    return people.filter((p) => (p.displayName ?? "").toLowerCase().includes(q));
  }, [people, query]);

  const assignedIds = new Set(currentAssignees.map((a) => a.id));

  const toggle = async (person: Person) => {
    const isAssigned = assignedIds.has(person.id);
    setPending((prev) => new Set(prev).add(person.id));

    if (isAssigned) {
      onChange(currentAssignees.filter((a) => a.id !== person.id));
      if (taskId) {
        const { error } = await supabase
          .from("task_assignees")
          .delete()
          .eq("task_id", taskId)
          .eq("user_id", person.id);
        if (error) console.error("[assignees] remove failed:", error.message);
      }
    } else {
      onChange([...currentAssignees, { id: person.id, displayName: person.displayName, avatarUrl: person.avatarUrl }]);
      if (taskId) {
        const { error } = await supabase.from("task_assignees").insert({ task_id: taskId, user_id: person.id });
        if (error) console.error("[assignees] add failed:", error.message);
      }
    }
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(person.id);
      return next;
    });
  };

  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Assign people"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fade-in"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 60,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_HEIGHT,
        display: "flex",
        flexDirection: "column",
        background: "#18181B",
        border: "1px solid #2D2E30",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        padding: 8,
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{
          height: 32,
          padding: "0 10px",
          background: "#212124",
          border: "1px solid #2D2E30",
          borderRadius: 8,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <Search size={13} color="#71717A" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          className="text-[12px] outline-none flex-1"
          style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
        />
      </div>

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        <div className="text-[11px] mb-1" style={{ color: "#71717A", padding: "2px 8px" }}>
          People
        </div>

        {people === null && (
          <div className="text-[12px]" style={{ color: "#52525B", padding: "8px" }}>
            Loading…
          </div>
        )}

        {people !== null && filtered.length === 0 && (
          <div className="text-[12px]" style={{ color: "#52525B", padding: "8px" }}>
            No matches.
          </div>
        )}

        {filtered.map((person) => {
          const isAssigned = assignedIds.has(person.id);
          const { text, bg } = getAvatarColorFromUserId(person.id);
          return (
            <button
              key={person.id}
              type="button"
              disabled={pending.has(person.id)}
              onClick={() => toggle(person)}
              className="flex items-center gap-2 w-full transition-colors"
              style={{
                background: "transparent",
                border: "none",
                borderRadius: 6,
                padding: "6px 8px",
                cursor: pending.has(person.id) ? "default" : "pointer",
                textAlign: "left",
                opacity: pending.has(person.id) ? 0.6 : 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {person.avatarUrl ? (
                <Image
                  src={person.avatarUrl}
                  alt=""
                  width={22}
                  height={22}
                  unoptimized
                  style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
                />
              ) : (
                <div
                  className="flex items-center justify-center rounded-full text-[10px] font-medium"
                  style={{ width: 22, height: 22, background: bg, color: text, flexShrink: 0 }}
                >
                  {resolveInitial({ display_name: person.displayName })}
                </div>
              )}
              <span className="text-[13px] flex-1 truncate" style={{ color: "#E4E4E7" }}>
                {person.displayName ?? person.email}
              </span>
              {isAssigned && <Check size={14} color="#108CE9" />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
