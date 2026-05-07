"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, ChevronLeft, Sparkles, X } from "lucide-react";
import { TEMPLATES } from "@/lib/constants";
import { TemplateCard } from "./TemplateCard";
import { EmojiPicker } from "./EmojiPicker";
import type { UserTemplate } from "@/types/stages";

type Props = {
  onCreate: (name: string, company: string, templateKey: string, emoji: string) => void;
  onCancel: () => void;
  userTemplates?: UserTemplate[];
  onDeleteUserTemplate?: (id: string) => void;
};

export function NewClientModal({
  onCreate, onCancel, userTemplates = [], onDeleteUserTemplate,
}: Props) {
  const [step, setStep] = useState<"info" | "template">("info");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [emoji, setEmoji] = useState("📋");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmojiPicker]);

  const handleNext = () => { if (name.trim()) setStep("template"); };
  const handleCreate = (templateKey: string | null) => {
    if (!name.trim() || !templateKey) return;
    onCreate(name.trim(), company.trim(), templateKey, emoji);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-2xl">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px] text-zinc-400">
              New pipeline · Step {step === "info" ? "1" : "2"} of 2
            </div>
            <h2 className="text-xl font-semibold mt-1">
              {step === "info" ? "Add a pipeline" : "Pick a starting point"}
            </h2>
          </div>
          <button onClick={onCancel} className="icon-btn"><X size={14} /></button>
        </div>

        {step === "info" ? (
          <div className="mt-5">
            <label className="block mb-3">
              <span className="text-[13px] text-zinc-400 block mb-1.5">
                Pipeline icon &amp; name
              </span>
              <div className="flex gap-2 items-stretch relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className="flex items-center justify-center transition-colors flex-shrink-0"
                  style={{
                    width: "48px",
                    height: "48px",
                    background: "#212124",
                    border: "1px solid #36363A",
                    borderRadius: "10px",
                    fontSize: "26px",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#28282C")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#212124")}
                  title="Pick an icon"
                >
                  {emoji}
                </button>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNext()}
                  className="field"
                  style={{ height: "48px", fontSize: "14px" }}
                  placeholder="Apex timelapse"
                />
                {showEmojiPicker && (
                  <div
                    ref={emojiPickerRef}
                    className="absolute top-full left-0 mt-2 z-50 fade-in"
                  >
                    <EmojiPicker
                      onPick={(emoji) => {
                        setEmoji(emoji);
                        setShowEmojiPicker(false);
                      }}
                      onClose={() => setShowEmojiPicker(false)}
                    />
                  </div>
                )}
              </div>
            </label>
            <label className="block mb-5">
              <span className="text-[13px] text-zinc-400 block mb-1.5">
                Client name <span className="text-zinc-600">(optional)</span>
              </span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNext()}
                className="field"
                placeholder="Apex roofing"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={onCancel} className="btn-ghost">Cancel</button>
              <button onClick={handleNext} disabled={!name.trim()} className="btn-primary">
                Next <ArrowRight size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            {userTemplates.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Bookmark size={13} style={{ color: "#979393" }} />
                  <span className="text-[13px]" style={{ color: "#979393" }}>
                    Your templates
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {userTemplates.map((tpl) => {
                    const totalTasks = tpl.stages.reduce(
                      (a, s) => a + (s.tasks?.length || 0),
                      0,
                    );
                    return (
                      <TemplateCard
                        key={tpl.id}
                        title={tpl.name}
                        description={`${tpl.stages.length} stages${
                          totalTasks > 0 ? ` · ${totalTasks} tasks` : " · structure only"
                        }`}
                        emoji={tpl.icon}
                        stages={tpl.stages.map((s) => s.name)}
                        selected={picked === tpl.id}
                        onClick={() => setPicked(tpl.id)}
                        onDelete={
                          onDeleteUserTemplate
                            ? () => {
                                if (confirm(`Delete template "${tpl.name}"?`)) {
                                  onDeleteUserTemplate(tpl.id);
                                  if (picked === tpl.id) setPicked(null);
                                }
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={13} style={{ color: "#979393" }} />
              <span className="text-[13px]" style={{ color: "#979393" }}>
                Starter templates
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              <TemplateCard
                title="Blank Workspace"
                description="Start with one stage and build it your way."
                icon={<Sparkles size={20} className="text-zinc-300" />}
                stages={["Stage 1"]}
                selected={picked === "blank"}
                onClick={() => setPicked("blank")}
              />
              {Object.entries(TEMPLATES).map(([key, tpl]) => (
                <TemplateCard
                  key={key}
                  title={tpl.name}
                  description={tpl.description}
                  emoji={tpl.icon}
                  stages={tpl.stages.map((s) => s.name)}
                  selected={picked === key}
                  onClick={() => setPicked(key)}
                />
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setStep("info")} className="btn-ghost">
                <ChevronLeft size={14} /> Back
              </button>
              <button
                onClick={() => handleCreate(picked)}
                disabled={!picked}
                className="btn-primary"
              >
                Create Pipeline <ArrowRight size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
