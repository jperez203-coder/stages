"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ImagePlus,
  Plus,
  Search,
  Smile,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EmojiPicker } from "@/components/home/EmojiPicker";
import { uploadPipelineLogo } from "@/lib/pipeline-logo";
import { ClientsTabIcon } from "@/components/icons/ClientsTabIcon";
import { StagesLogo } from "@/components/icons/StagesLogo";

/**
 * "Create Portal" modal — redesign of the old two-step /p/new ROUTE
 * (name+emoji page -> TemplatePickerModal overlay) into a single modal
 * matching the new Figma: pick a template first, then name the portal
 * and give it an icon/logo, with a summary of the chosen template.
 *
 * Reuses the EXACT same data + RPC as the old flow — this is a redesign,
 * not a new backend:
 *   - `templates` fetch: same query/shape as TemplatePickerModal.tsx
 *   - Creation: same `create_pipeline_with_channels` RPC (5-arg version,
 *     20260609120000_create_pipeline_with_channels_template_id.sql)
 *   - "Saved Templates" = workspace_id IS NOT NULL, "Starter Templates"
 *     (Figma's "Templates by Stages" row — kept the app's existing name
 *     since that's what the two built-ins, Blank Workspace + GHL Client
 *     Onboarding, already are) = workspace_id IS NULL
 *
 * New in this pass: a per-pipeline logo. Since the pipeline doesn't
 * exist yet while picking an icon, the chosen File is held in memory and
 * only actually uploaded (via uploadPipelineLogo) right after the RPC
 * returns a real pipeline_id — same sequencing the workspace-logo
 * feature doesn't need (that one's row already exists).
 *
 * Per Jordan: the "Preview" section (a mockup dashboard in the Figma —
 * My Active Tasks / Project Pipeline / Recent activity feed cards) is
 * NOT built here — it's Figma illustration, left as an empty placeholder
 * until the real client-portal view exists to actually preview.
 */

type TemplateStage = {
  id: string;
  position: number;
  name: string;
  template_tasks: { count: number }[];
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  workspace_id: string | null;
  template_stages: TemplateStage[];
};

type Step = "template" | "details";
type FetchStatus = "loading" | "ready" | "error";

const MAX_SAVED_PREVIEW = 3;

/**
 * Placeholder "Saved Templates" preview row — no real saved-template
 * feature backs this yet (that's `savedTemplates`/workspace_id-scoped
 * templates below), so these 3 are hardcoded display-only cards to show
 * how the section looks with content until that's real.
 */
const MOCK_SAVED_TEMPLATES = [
  "Website Design",
  "Meta Ads Launch",
  "SEO Audit",
  "Email Onboarding",
  "Social Content Calendar",
  "Brand Refresh",
];

/**
 * Placeholder "Templates by Stages" cards — only 2 real starter templates
 * exist today (Blank Workspace, GHL Client Onboarding), so these 4 fill
 * out the row permanently (no "see more", unlike MOCK_SAVED_TEMPLATES)
 * until more real starter templates exist.
 */
const MOCK_STARTER_TEMPLATES = [
  "Podcast Production",
  "App Launch Checklist",
  "Event Planning",
  "Video Editing Pipeline",
];

function templateStats(t: Template): { projects: number; tasks: number } {
  const projects = t.template_stages.length;
  const tasks = t.template_stages.reduce(
    (sum, s) => sum + (s.template_tasks[0]?.count ?? 0),
    0,
  );
  return { projects, tasks };
}

export function CreatePortalModal({
  workspaceId,
  slug,
  userId,
  onClose,
}: {
  workspaceId: string;
  slug: string;
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("template");
  const [query, setQuery] = useState("");
  const [showAllSaved, setShowAllSaved] = useState(false);
  const [showAllMockSaved, setShowAllMockSaved] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📋");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [iconMenuOpen, setIconMenuOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const iconMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Locks the dialog to its natural (collapsed) height the first time
  // templates finish loading, so expanding "See N more" scrolls the body
  // instead of growing the whole modal.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setFetchError(null);
    void (async () => {
      const { data, error: fetchErr } = await supabase
        .from("templates")
        .select(
          `id, name, description, emoji, workspace_id,
           template_stages ( id, position, name, template_tasks ( count ) )`,
        )
        .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
        .order("workspace_id", { ascending: true, nullsFirst: true });

      if (cancelled) return;
      if (fetchErr) {
        console.error("[create-portal] templates fetch failed:", fetchErr.message);
        setFetchError(fetchErr.message);
        setStatus("error");
        return;
      }
      setTemplates((data as Template[]) ?? []);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useLayoutEffect(() => {
    if (step !== "template" || status !== "ready" || lockedHeight !== null) return;
    const height = dialogRef.current?.getBoundingClientRect().height;
    if (height) setLockedHeight(height);
  }, [step, status, lockedHeight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  useEffect(() => {
    if (!iconMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (iconMenuRef.current && !iconMenuRef.current.contains(e.target as Node)) {
        setIconMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [iconMenuOpen]);

  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const savedTemplates = filtered.filter((t) => t.workspace_id !== null);
  const starterTemplates = filtered.filter((t) => t.workspace_id === null);
  const visibleSaved = showAllSaved ? savedTemplates : savedTemplates.slice(0, MAX_SAVED_PREVIEW);

  const pickTemplate = (t: Template) => {
    setSelectedTemplateId(t.id);
    setStep("details");
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    setLogoFile(file);
    setLogoPreviewUrl(URL.createObjectURL(file));
    setIconMenuOpen(false);
  };

  const canSubmit = name.trim().length > 0 && !!selectedTemplateId && !submitting;

  const handleCreate = async () => {
    const cleanedName = name.trim();
    if (!cleanedName || !selectedTemplateId) return;
    setSubmitting(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "create_pipeline_with_channels",
      {
        workspace_id: workspaceId,
        pipeline_name: cleanedName,
        pipeline_emoji: emoji,
        pipeline_company: null,
        template_id: selectedTemplateId,
      },
    );

    if (rpcError || !data) {
      console.error("[create-portal] create_pipeline_with_channels failed:", rpcError?.message);
      setError(rpcError?.message ?? "Couldn't create the portal.");
      setSubmitting(false);
      return;
    }

    type CreateResult = { pipeline_id: string };
    const result = data as CreateResult;

    if (logoFile) {
      const { error: logoError } = await uploadPipelineLogo(result.pipeline_id, logoFile);
      if (logoError) {
        // Non-fatal — the portal exists; logo can be added again from
        // inside it. Same soft-fail precedent as the create page's
        // last_active_pipeline_id write.
        console.error("[create-portal] logo upload failed:", logoError.message);
      }
    }

    void supabase
      .from("profiles")
      .update({ last_active_pipeline_id: result.pipeline_id })
      .eq("id", userId)
      .then(({ error: profileError }) => {
        if (profileError) {
          console.error(
            "[create-portal] last_active_pipeline_id update failed:",
            profileError.message,
          );
        }
      });

    setSubmitting(false);
    router.push(`/w/${slug}/p/${result.pipeline_id}`);
  };

  return (
    <div
      className="fade-in"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onMouseDown={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Create client portal"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 860,
          height: lockedHeight ?? undefined,
          maxHeight: "90vh",
          background: "#181818",
          border: "1px solid #2D2E30",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: "10px 24px", borderBottom: "1px solid #2D2E30" }}
        >
          <div className="flex items-center gap-2.5">
            {step === "details" && (
              <button
                type="button"
                onClick={() => setStep("template")}
                disabled={submitting}
                aria-label="Back"
                className="flex items-center justify-center rounded-md transition-colors"
                style={{ width: 26, height: 26, background: "transparent", border: "none", color: "#979393", cursor: submitting ? "not-allowed" : "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <ClientsTabIcon size={18} />
            <span className="font-poppins text-[16px] font-medium" style={{ color: "#E4E4E7" }}>
              Clients
            </span>
          </div>
          <div className="flex items-center gap-3">
            {step === "details" && (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={handleCreate}
                className="rounded-lg font-medium text-white transition-colors"
                style={{
                  padding: "6px 14px",
                  background: "#108CE9",
                  border: "none",
                  fontSize: 13,
                  opacity: canSubmit ? 1 : 0.5,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {submitting ? "Creating…" : "Create Portal"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
              className="flex items-center justify-center rounded-full transition-colors"
              style={{ width: 26, height: 26, background: "#2C2C2F", border: "none", color: "#979393", cursor: submitting ? "not-allowed" : "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FFFFFF")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#979393")}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", minHeight: 0 }}>
          {step === "template" ? (
            <>
              <div
                className="flex items-center gap-2"
                style={{ height: 32, maxWidth: 460, padding: "0 14px", background: "#1F1F1F", border: "1px solid #2D2E30", borderRadius: 9, marginBottom: 28 }}
              >
                <Search size={15} color="#71717A" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search templates…"
                  className="text-[13px] outline-none flex-1"
                  style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
                />
              </div>

              {status === "loading" && (
                <div className="grid grid-cols-3 gap-5" aria-label="Loading templates">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="animate-pulse" style={{ height: 220, background: "#212124", border: "1px solid #2D2E30", borderRadius: 10 }} />
                  ))}
                </div>
              )}

              {status === "error" && (
                <div className="flex items-start gap-2 text-[13px]" style={{ padding: 12, background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.3)", borderRadius: 8, color: "#F43F5E" }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>Couldn&apos;t load templates: {fetchError ?? "unknown error"}.</span>
                </div>
              )}

              {status === "ready" && (
                <>
                  {savedTemplates.length > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                        <h3 className="text-[16px] font-semibold" style={{ color: "#E4E4E7", margin: 0 }}>
                          Saved Templates
                        </h3>
                        {savedTemplates.length > MAX_SAVED_PREVIEW && (
                          <button
                            type="button"
                            onClick={() => setShowAllSaved((v) => !v)}
                            className="text-[13px]"
                            style={{ background: "transparent", border: "none", color: "#979393", cursor: "pointer" }}
                          >
                            {showAllSaved ? "Show less" : `See ${savedTemplates.length - MAX_SAVED_PREVIEW} more`}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-5">
                        {visibleSaved.map((t) => (
                          <TemplateGalleryCard key={t.id} template={t} onSelect={() => pickTemplate(t)} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 28 }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                      <h3 className="text-[16px] font-semibold" style={{ color: "#E4E4E7", margin: 0 }}>
                        Saved Templates
                      </h3>
                      {MOCK_SAVED_TEMPLATES.length > MAX_SAVED_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => setShowAllMockSaved((v) => !v)}
                          className="text-[13px]"
                          style={{ background: "transparent", border: "none", color: "#979393", cursor: "pointer" }}
                        >
                          {showAllMockSaved
                            ? "Show less"
                            : `See ${MOCK_SAVED_TEMPLATES.length - MAX_SAVED_PREVIEW} more`}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-5">
                      {(showAllMockSaved
                        ? MOCK_SAVED_TEMPLATES
                        : MOCK_SAVED_TEMPLATES.slice(0, MAX_SAVED_PREVIEW)
                      ).map((name) => (
                        <MockTemplateCard key={name} name={name} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-4" style={{ marginBottom: 14 }}>
                      <h3 className="text-[16px] font-semibold flex-shrink-0" style={{ color: "#E4E4E7", margin: 0 }}>
                        Templates by Stages
                      </h3>
                      <div style={{ flex: 1, height: 1, background: "#2D2E30" }} />
                    </div>
                    <div className="grid grid-cols-3 gap-5">
                      <BlankTemplateCard
                        template={starterTemplates.find((t) => t.template_stages.length <= 1 && t.name.toLowerCase().includes("blank"))}
                        onSelect={(t) => pickTemplate(t)}
                        icon={<StagesLogo size={11} />}
                      />
                      {starterTemplates
                        .filter((t) => !t.name.toLowerCase().includes("blank"))
                        .map((t) => (
                          <TemplateGalleryCard key={t.id} template={t} onSelect={() => pickTemplate(t)} icon={<StagesLogo size={11} />} />
                        ))}
                      {MOCK_STARTER_TEMPLATES.map((name) => (
                        <MockTemplateCard key={name} name={name} icon={<StagesLogo size={11} />} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            selectedTemplate && (
              <>
                <div className="flex items-center gap-2 mb-5" style={{ position: "relative" }}>
                  <div ref={iconMenuRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setIconMenuOpen((v) => !v)}
                      title="Portal icon"
                      className="flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{
                        width: 44,
                        height: 44,
                        background: "#212124",
                        border: "1px solid #36363A",
                        borderRadius: 10,
                        fontSize: 22,
                        cursor: "pointer",
                        overflow: "hidden",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#28282C")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#212124")}
                    >
                      {logoPreviewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote asset
                        <img src={logoPreviewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        emoji
                      )}
                    </button>
                    {iconMenuOpen && (
                      <div
                        className="fade-in"
                        style={{
                          position: "absolute",
                          top: "calc(100% + 6px)",
                          left: 0,
                          zIndex: 10,
                          minWidth: 170,
                          background: "#18181B",
                          border: "1px solid #2D2E30",
                          borderRadius: 10,
                          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                          padding: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setIconMenuOpen(false);
                            setShowEmojiPicker(true);
                          }}
                          className="w-full flex items-center gap-2 rounded text-left text-[13px] transition-colors"
                          style={{ padding: "8px 10px", background: "transparent", border: "none", cursor: "pointer", color: "#E4E4E7" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <Smile size={14} /> Choose emoji
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 rounded text-left text-[13px] transition-colors"
                          style={{ padding: "8px 10px", background: "transparent", border: "none", cursor: "pointer", color: "#E4E4E7" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <ImagePlus size={14} /> Upload logo
                        </button>
                      </div>
                    )}
                    {showEmojiPicker && (
                      <div
                        className="fade-in"
                        style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 10 }}
                      >
                        <EmojiPicker
                          onPick={(picked) => {
                            setEmoji(picked);
                            setLogoFile(null);
                            if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
                            setLogoPreviewUrl(null);
                            setShowEmojiPicker(false);
                          }}
                          onClose={() => setShowEmojiPicker(false)}
                        />
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoFileChange}
                    />
                  </div>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Company name"
                    className="flex-1 text-[16px] font-medium outline-none"
                    style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
                  />
                </div>

                <div
                  className="flex items-start gap-3"
                  style={{ padding: 14, background: "#111111", border: "1px solid #2D2E30", borderRadius: 12, marginBottom: 16 }}
                >
                  <TemplatePreviewGraphic stages={selectedTemplate.template_stages.length} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 16, lineHeight: 1 }}>{selectedTemplate.emoji}</span>
                      <span className="text-[14px] font-semibold" style={{ color: "#E4E4E7" }}>
                        {selectedTemplate.name}
                      </span>
                      <span className="text-[12px]" style={{ color: "#71717A" }}>
                        {templateStats(selectedTemplate).projects} projects · {templateStats(selectedTemplate).tasks} tasks
                      </span>
                    </div>
                    {selectedTemplate.description && (
                      <p className="text-[12px] mt-1" style={{ color: "#979393", lineHeight: 1.5 }}>
                        {selectedTemplate.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-[12px] font-semibold" style={{ color: "#71717A", marginBottom: 8 }}>
                  Preview
                </div>
                {/* Placeholder — the real portal-dashboard preview (per
                    Jordan) gets built once that view exists to render for
                    real; this is intentionally blank until then. */}
                <div style={{ height: 160, background: "#111111", border: "1px dashed #2D2E30", borderRadius: 12 }} />

                {error && (
                  <p className="text-[12px] mt-3" style={{ color: "#F43F5E" }}>
                    {error}
                  </p>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCardIcon({ emoji, icon }: { emoji: string; icon?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        width: 24,
        height: 24,
        borderRadius: 12,
        background: "#181818",
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      {icon ?? emoji}
    </div>
  );
}

function BookmarkIcon() {
  return (
    <svg width="10" height="11" viewBox="0 0 13 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 4.83683C0 2.55673 0 1.41667 0.713927 0.708337C1.42785 0 2.5769 0 4.875 0H8.125C10.4231 0 11.5721 0 12.2861 0.708337C13 1.41667 13 2.55673 13 4.83683V10.3408C13 12.5039 13 13.5855 12.314 13.9163C11.628 14.2471 10.7709 13.5789 9.05656 12.2425L8.50792 11.8148C7.54399 11.0633 7.06203 10.6876 6.5 10.6876C5.93797 10.6876 5.45601 11.0633 4.49208 11.8148L3.94344 12.2425C2.22913 13.5789 1.37198 14.2471 0.685989 13.9163C0 13.5855 0 12.5039 0 10.3408V4.83683Z"
        fill="#FFCA46"
      />
    </svg>
  );
}

/**
 * Display-only stand-in for the not-yet-real "Saved Templates" feature —
 * see MOCK_SAVED_TEMPLATES. Same card shape as TemplateGalleryCard but
 * with a fixed bookmark badge instead of a per-template emoji, and no
 * onSelect since there's no real template behind it to create a portal
 * from.
 */
function MockTemplateCard({ name, icon = <BookmarkIcon /> }: { name: string; icon?: React.ReactNode }) {
  return (
    <div
      className="flex flex-col text-left rounded-[10px] overflow-hidden"
      style={{ background: "#212124", border: "1px solid #2D2E30" }}
    >
      <div style={{ position: "relative" }}>
        <div
          className="flex items-center justify-center"
          style={{ aspectRatio: "384 / 193", background: "#212025", overflow: "hidden" }}
        >
          <TemplatePreviewGraphic stages={2} />
        </div>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{ position: "absolute", top: 10, left: 10, width: 24, height: 24, borderRadius: 12, background: "#181818" }}
        >
          {icon}
        </div>
      </div>
      <div
        className="flex items-center gap-2.5"
        style={{ padding: "9px 14px", borderTop: "1px solid #2D2E30", background: "#181818", borderRadius: "0 0 9px 9px" }}
      >
        <span className="text-[13px] font-normal truncate" style={{ color: "#979393" }}>
          {name}
        </span>
      </div>
    </div>
  );
}

function TemplateGalleryCard({
  template,
  onSelect,
  icon,
}: {
  template: Template;
  onSelect: () => void;
  icon?: React.ReactNode;
}) {
  const stats = templateStats(template);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col text-left rounded-[10px] transition-colors overflow-hidden"
      style={{ background: "#212124", border: "1px solid #2D2E30", cursor: "pointer", padding: 0 }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2D2E30")}
    >
      <div style={{ position: "relative" }}>
        <div
          className="flex items-center justify-center"
          style={{ aspectRatio: "384 / 193", background: "#212025", overflow: "hidden" }}
        >
          <TemplatePreviewGraphic stages={stats.projects} />
        </div>
        <TemplateCardIcon emoji={template.emoji} icon={icon} />
      </div>
      <div
        className="flex items-center gap-2.5"
        style={{ padding: "9px 14px", borderTop: "1px solid #2D2E30", background: "#181818", borderRadius: "0 0 9px 9px" }}
      >
        <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{template.emoji}</span>
        <span className="text-[13px] font-normal truncate" style={{ color: "#979393" }}>
          {template.name}
        </span>
      </div>
    </button>
  );
}

function BlankTemplateCard({
  template,
  onSelect,
  icon,
}: {
  template?: Template;
  onSelect: (t: Template) => void;
  icon?: React.ReactNode;
}) {
  if (!template) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="flex flex-col text-left rounded-[10px] transition-colors overflow-hidden"
      style={{ background: "#212124", border: "1px solid #2D2E30", cursor: "pointer", padding: 0 }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2D2E30")}
    >
      <div style={{ position: "relative" }}>
        <div
          className="flex items-center justify-center"
          style={{ aspectRatio: "384 / 193", background: "#212025" }}
        >
          <Plus size={28} color="#71717A" />
        </div>
        <TemplateCardIcon emoji={template.emoji} icon={icon} />
      </div>
      <div
        className="flex items-center gap-2.5"
        style={{ padding: "9px 14px", borderTop: "1px solid #2D2E30", background: "#181818", borderRadius: "0 0 9px 9px" }}
      >
        <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{template.emoji}</span>
        <span className="text-[13px] font-normal truncate" style={{ color: "#979393" }}>
          {template.name}
        </span>
      </div>
    </button>
  );
}

/**
 * Decorative "connected boxes" flow-diagram graphic filling the card
 * thumbnail — generic, not computed per-template beyond how many boxes it
 * draws. A real per-template preview (actual node positions/colors) is
 * later polish, same call as skipping the full dashboard mockup below.
 */
function TemplatePreviewGraphic({ stages }: { stages: number }) {
  const count = Math.max(1, Math.min(stages, 3));
  return (
    <div className="flex items-center gap-2.5" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <div style={{ width: 40, height: 28, borderRadius: 6, background: "#6B60C9" }} />
          {i < count - 1 && <div style={{ width: 16, height: 1, background: "#4A4A50" }} />}
        </div>
      ))}
    </div>
  );
}
