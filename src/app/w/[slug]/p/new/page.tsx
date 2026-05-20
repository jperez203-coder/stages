"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Plus } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { supabase } from "@/lib/supabase";

const MAX_NAME_LENGTH = 80;
const DEFAULT_EMOJI = "📋";

// Small shortlist of MVP emoji presets so users can differentiate pipelines
// visually without us pulling in a full emoji picker library yet. A "type
// your own" affordance lives below the presets for anything not in this set.
const EMOJI_PRESETS = ["📋", "🎯", "🚀", "💼", "🎨", "🛠️", "📊", "📈", "✨"];

/**
 * Shape of `create_pipeline_with_channels` RPC's return value. See
 * supabase/migrations/20260519130000_create_pipeline_with_channels.sql for
 * the source-of-truth definition.
 */
type CreateResult = {
  pipeline_id: string;
  name: string;
  emoji: string;
  company: string | null;
};

/**
 * /w/[slug]/p/new — create a new pipeline in the active workspace.
 *
 * Single-route flow for Phase 4a step 1. The dashboard's "+ New Pipeline"
 * button (Phase 4a step 2) will link here. Modal-vs-route was a coin flip;
 * dedicated route wins for the MVP because:
 *   * Direct linkability (share + bookmark)
 *   * Browser back behaviour works without modal stack management
 *   * AppShell chrome stays visible (same context as the rest of /w/[slug])
 *
 * Permission: workspace owner OR admin. Plain workspace members get the
 * "no permission" panel-card instead of the form. The RPC enforces the same
 * gate server-side (defense-in-depth — UI lock + RPC gate, same pattern as
 * Phase 3.4 §3 prefill+lock on /accept-invite/[token]).
 *
 * Post-success redirect: /w/[slug]/p/[new-pipeline-id] — currently a stub
 * (Phase 4a step 5 builds the canvas). Acceptable stub destination per the
 * step 1 scope: the create flow itself is what's being verified.
 */
export default function CreatePipelinePage() {
  const router = useRouter();
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : null;

  const session = useSession();
  const contexts = useUserContexts();

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Resolve workspace from slug + check permission ──────────────────────
  // useUserContexts is already fetched on AppShell mount (siblings to this
  // route use it for the workspace switcher), so this is a free read.
  // Prefers a workspace-level membership (source='workspace') over a
  // pipeline-level one — only workspace memberships unlock owner/admin
  // role for create. A user who's a pipeline-level admin on some pipeline
  // in this workspace still isn't a workspace owner/admin and can't create
  // new pipelines.
  const workspace = useMemo(() => {
    if (contexts.status !== "ready") return null;
    return (
      contexts.contexts.find(
        (c) =>
          c.type === "agency" &&
          c.source === "workspace" &&
          c.workspaceSlug === slug,
      ) ?? null
    );
  }, [contexts, slug]);

  const canCreate =
    !!workspace &&
    (workspace.role === "owner" || workspace.role === "admin");

  // ── Guards ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  // If contexts are ready and the user has no membership at all in this
  // workspace's slug, send them home rather than show a confusing "no
  // permission" panel (which would imply they're at least a workspace
  // member). Distinguishes "wrong workspace" from "right workspace but
  // insufficient role."
  useEffect(() => {
    if (contexts.status !== "ready") return;
    const anyContextForSlug = contexts.contexts.some(
      (c) => c.workspaceSlug === slug,
    );
    if (!anyContextForSlug) {
      router.replace("/");
    }
  }, [contexts, slug, router]);

  // ── Form state ──────────────────────────────────────────────────────────
  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const empty = trimmed === "";
  const canSubmit =
    !empty && !tooLong && !submitting && canCreate && !!workspace;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !workspace) return;
    if (session.status !== "authenticated") return;

    setSubmitting(true);
    setError(null);

    const trimmedCompany = company.trim();
    const { data, error: rpcError } = await supabase.rpc(
      "create_pipeline_with_channels",
      {
        workspace_id: workspace.workspaceId,
        pipeline_name: trimmed,
        pipeline_emoji: emoji,
        // Empty string sent as-is; the RPC's trim + nullif collapses
        // it to NULL on the DB side, matching the "show only when set"
        // rule the dashboard's PipelineCard uses to render the company
        // line.
        pipeline_company: trimmedCompany,
      },
    );

    if (rpcError) {
      setError(rpcError.message);
      setSubmitting(false);
      return;
    }

    const result = data as CreateResult | null;
    if (!result?.pipeline_id) {
      setError(
        "Pipeline was created but the response was malformed. Please refresh.",
      );
      setSubmitting(false);
      return;
    }

    // Persist last_active_pipeline_id so a returning sign-in lands the user
    // here. Same .select()+rowcount pattern Phase F established for silent
    // RLS denial detection; failure is non-fatal — we route to the new
    // pipeline either way.
    const { error: profErr, data: profData } = await supabase
      .from("profiles")
      .update({ last_active_pipeline_id: result.pipeline_id })
      .eq("id", session.user.id)
      .select();
    if (profErr) {
      console.error(
        "Failed to persist last_active_pipeline_id after create:",
        profErr.message,
      );
    } else if (!profData || profData.length === 0) {
      console.warn(
        "last_active_pipeline_id update affected 0 rows after create — RLS denial or missing profile row?",
      );
    }

    router.push(`/w/${slug}/p/${result.pipeline_id}`);
  };

  // ── Render branches ─────────────────────────────────────────────────────

  // Loading: session resolving, or contexts not yet fetched. Both happen
  // briefly on mount; combined into one placeholder to avoid flashing
  // intermediate states.
  // All five render branches below share the same outer chrome: the
  // dotted-grid background (same .dotted-grid class used by the dashboard)
  // + min-h-full to fill the AppShell content area. Inner max-w-2xl keeps
  // the form/panel centered with reasonable reading width.
  if (
    session.status === "loading" ||
    session.status === "anonymous" ||
    contexts.status === "loading"
  ) {
    return (
      <div className="dotted-grid min-h-full px-4 sm:px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="text-[13px] text-zinc-500">Loading…</div>
        </div>
      </div>
    );
  }

  if (contexts.status === "error") {
    return (
      <div className="dotted-grid min-h-full px-4 sm:px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="panel-card p-6 flex items-start gap-3 text-[13px] text-stages-red">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>Couldn&apos;t load your workspace contexts: {contexts.message}</span>
          </div>
        </div>
      </div>
    );
  }

  // workspace = null after contexts ready means the second effect above
  // is about to redirect. Render a brief placeholder so we don't flash the
  // "no permission" UI mid-redirect.
  if (!workspace) {
    return (
      <div className="dotted-grid min-h-full px-4 sm:px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="text-[13px] text-zinc-500">Loading…</div>
        </div>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="dotted-grid min-h-full px-4 sm:px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => router.push(`/w/${slug}`)}
            className="text-[13px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 mb-6 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to {workspace.workspaceName}
          </button>
          <div className="panel-card p-6 flex items-start gap-3">
            <AlertCircle
              size={18}
              className="text-stages-amber flex-shrink-0 mt-0.5"
            />
            <div>
              <div className="text-[14px] font-medium mb-1">
                You don&apos;t have permission to create pipelines here.
              </div>
              <p className="text-[13px] text-zinc-400 leading-snug">
                Only workspace owners and admins can create new pipelines in{" "}
                <span className="text-zinc-200">{workspace.workspaceName}</span>.
                Ask an owner or admin to create the pipeline, or to upgrade
                your role.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dotted-grid min-h-full px-4 sm:px-6 py-8">
      <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push(`/w/${slug}`)}
        className="text-[13px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 mb-6 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to {workspace.workspaceName}
      </button>

      <h1 className="text-[24px] font-semibold mb-1">New pipeline</h1>
      <p className="text-[14px] text-zinc-500 mb-8">
        Start a new client engagement in{" "}
        <span className="text-zinc-300">{workspace.workspaceName}</span>.
      </p>

      <form onSubmit={submit} className="panel-card p-6">
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Pipeline name</span>
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Q3 Rebrand"
          maxLength={MAX_NAME_LENGTH}
          className="field mb-2"
          disabled={submitting}
        />
        <p className="text-[12px] text-zinc-600 mb-6 leading-relaxed">
          Up to {MAX_NAME_LENGTH} characters.
        </p>

        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">
            Company{" "}
            <span className="text-zinc-600">(optional)</span>
          </span>
        </label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Acme Inc"
          maxLength={MAX_NAME_LENGTH}
          className="field mb-2"
          disabled={submitting}
        />
        <p className="text-[12px] text-zinc-600 mb-6 leading-relaxed">
          The client or business this pipeline is for. Shows under the
          pipeline name on the dashboard.
        </p>

        <label className="block mb-2">
          <span className="text-[13px] text-zinc-400">Icon</span>
        </label>
        <div className="flex flex-wrap gap-2 mb-6">
          {EMOJI_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setEmoji(preset)}
              disabled={submitting}
              className="flex items-center justify-center transition-all"
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background:
                  emoji === preset
                    ? "rgba(16, 140, 233, 0.15)"
                    : "#2A2A2D",
                border:
                  emoji === preset
                    ? "1px solid rgba(16, 140, 233, 0.5)"
                    : "1px solid #36363A",
                fontSize: "16px",
                cursor: submitting ? "not-allowed" : "pointer",
              }}
              aria-label={`Select ${preset} icon`}
              aria-pressed={emoji === preset}
            >
              {preset}
            </button>
          ))}
        </div>

        {tooLong && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Pipeline name is too long ({trimmed.length} of{" "}
              {MAX_NAME_LENGTH} characters).
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push(`/w/${slug}`)}
            disabled={submitting}
            className="btn-ghost"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary"
          >
            <Plus size={14} strokeWidth={2.5} />
            {submitting ? "Creating…" : "Create pipeline"}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
