"use client";

import { CheckCircle2, Clock, Copy, Lock, Sparkles, Trash2, UserPlus } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { timeAgo } from "@/lib/format";
import type { Client, Session, TeamInvite } from "@/types/stages";

type Props = {
  client: Client;
  session: Session;
  pendingInvites: (TeamInvite & { token: string })[];
  onShowInvite: () => void;
  onRemoveMember: (email: string) => void;
  onPromoteToAdmin: (email: string) => void;
  onDemoteToMember: (email: string) => void;
  onToggleAdminCanSubmit: (email: string) => void;
  onToggleMemberCanCheckTasks: (email: string) => void;
  isOwner: boolean;
};

function RolePill({ role }: { role: "owner" | "admin" | "member" }) {
  if (role === "owner")
    return (
      <span
        className="badge"
        style={{ background: "#108CE922", borderColor: "#108CE944", color: "#7EC2F4" }}
      >
        Owner
      </span>
    );
  if (role === "admin")
    return (
      <span
        className="badge"
        style={{ background: "#8B5CF622", borderColor: "#8B5CF644", color: "#C4B5FD" }}
      >
        Admin
      </span>
    );
  return <span className="badge text-zinc-400">Member</span>;
}

export function MembersView({
  client, session, pendingInvites, onShowInvite,
  onRemoveMember, onPromoteToAdmin, onDemoteToMember, onToggleAdminCanSubmit,
  onToggleMemberCanCheckTasks, isOwner,
}: Props) {
  const members = client.members || [];
  // Admins can also grant canCheckTasks to members (lower-stakes than canSubmit).
  const myMember = members.find((m) => m.email === session.email);
  const isAdmin = myMember?.role === "admin";
  const canManageMembers = isOwner || isAdmin;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="text-[13px] text-zinc-400 mb-1">Workspace</div>
          <h2 className="text-2xl font-semibold mb-1">Team Members</h2>
          <div className="text-[13px] text-zinc-500">
            People with access to this client workspace only.
          </div>
        </div>
        {isOwner && (
          <button onClick={onShowInvite} className="btn-primary">
            <UserPlus size={14} strokeWidth={2.5} /> Invite
          </button>
        )}
      </div>

      {canManageMembers && (
        <div
          className="rounded-lg px-4 py-3 mb-4 text-[12px] leading-relaxed"
          style={{ background: "#1A1A1C", border: "1px solid #36363A", color: "#979393" }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Lock size={12} style={{ color: "#7EC2F4" }} />
            <span className="font-semibold" style={{ color: "#E4E4E7" }}>
              Roles
            </span>
          </div>
          <div>
            <span style={{ color: "#7EC2F4", fontWeight: 600 }}>Owner</span> — full access · the
            only one who can submit the final pipeline (unless they delegate)
          </div>
          <div>
            <span style={{ color: "#C4B5FD", fontWeight: 600 }}>Admin</span> — full edit access ·
            can submit the final pipeline only if owner grants permission
          </div>
          <div>
            <span style={{ color: "#A1A1AA", fontWeight: 600 }}>Member</span> — can view, comment,
            and check off tasks if owner or admin grants the permission
          </div>
        </div>
      )}

      <div className="panel-card overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
          <Avatar email={client.ownerEmail || ""} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate">{client.ownerEmail}</div>
            <div className="text-[13px] text-zinc-500">Workspace owner</div>
          </div>
          <RolePill role="owner" />
        </div>

        {members.map((m) => {
          const role: "admin" | "member" = m.role === "admin" ? "admin" : "member";
          const isAdmin = role === "admin";
          return (
            <div
              key={m.email}
              className="flex items-center gap-3 p-4 border-b border-zinc-800 last:border-0 group flex-wrap"
            >
              <Avatar email={m.email} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{m.email}</div>
                <div className="text-[13px] text-zinc-500">
                  Joined {timeAgo(m.joinedAt)}
                  {isAdmin && m.canSubmit && (
                    <>
                      {" · "}
                      <span style={{ color: "#34D399" }}>can submit final pipeline</span>
                    </>
                  )}
                </div>
              </div>

              <RolePill role={role} />

              {canManageMembers && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* canSubmit toggle — admins only, and only owner can grant. */}
                  {isAdmin && isOwner && (
                    <button
                      onClick={() => onToggleAdminCanSubmit(m.email)}
                      className="inline-flex items-center gap-1.5 rounded-full transition-colors"
                      style={{
                        background: m.canSubmit ? "#15B98122" : "transparent",
                        border: `1px solid ${m.canSubmit ? "#15B98166" : "#36363A"}`,
                        color: m.canSubmit ? "#34D399" : "#71717A",
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      title={
                        m.canSubmit
                          ? "Can submit the final pipeline — click to revoke"
                          : "Cannot submit the final pipeline — click to grant"
                      }
                    >
                      {m.canSubmit ? <CheckCircle2 size={11} /> : <Lock size={11} />}
                      <span>{m.canSubmit ? "Can submit" : "No submit"}</span>
                    </button>
                  )}

                  {/* canCheckTasks toggle — members only; owner or admin can grant. */}
                  {!isAdmin && (
                    <button
                      onClick={() => onToggleMemberCanCheckTasks(m.email)}
                      className="inline-flex items-center gap-1.5 rounded-full transition-colors"
                      style={{
                        background: m.canCheckTasks ? "#15B98122" : "transparent",
                        border: `1px solid ${m.canCheckTasks ? "#15B98166" : "#36363A"}`,
                        color: m.canCheckTasks ? "#34D399" : "#71717A",
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      title={
                        m.canCheckTasks
                          ? "Can check off tasks — click to revoke"
                          : "Cannot check tasks — click to grant"
                      }
                    >
                      {m.canCheckTasks ? <CheckCircle2 size={11} /> : <Lock size={11} />}
                      <span>{m.canCheckTasks ? "Can check tasks" : "No check"}</span>
                    </button>
                  )}

                  {/* Promote/Demote/Remove — owner only. */}
                  {isOwner && (
                    <>
                      {isAdmin ? (
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Demote ${m.email} to Member? They'll lose admin permissions.`,
                              )
                            ) {
                              onDemoteToMember(m.email);
                            }
                          }}
                          className="btn-ghost"
                          style={{ padding: "4px 10px", fontSize: "11px" }}
                          title="Demote to member"
                        >
                          Demote
                        </button>
                      ) : (
                        <button
                          onClick={() => onPromoteToAdmin(m.email)}
                          className="btn-ghost"
                          style={{ padding: "4px 10px", fontSize: "11px" }}
                          title="Promote to admin"
                        >
                          <Sparkles size={11} strokeWidth={2.5} /> Promote
                        </button>
                      )}

                      <button
                        onClick={() => {
                          if (confirm(`Remove ${m.email}?`)) onRemoveMember(m.email);
                        }}
                        className="icon-btn opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: "#F87171" }}
                        title="Remove from pipeline"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {members.length === 0 && pendingInvites.length === 0 && (
          <div className="p-8 text-center text-[13px] text-zinc-500">
            No team members yet. {isOwner && "Click Invite to add someone."}
          </div>
        )}
      </div>
      {pendingInvites.length > 0 && (
        <>
          <div className="text-[13px] text-zinc-400 mt-8 mb-3">Pending invitations</div>
          <div className="panel-card overflow-hidden">
            {pendingInvites.map((inv) => {
              const link = `${window.location.origin}${window.location.pathname}?invite=${inv.token}`;
              return (
                <div
                  key={inv.token}
                  className="flex items-center gap-3 p-4 border-b border-zinc-800 last:border-0 flex-wrap"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "#F59E0B22", color: "#F59E0B" }}
                  >
                    <Clock size={14} />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-[13px] font-semibold truncate">{inv.email}</div>
                    <div className="text-[13px] text-zinc-500">
                      Invited {timeAgo(inv.createdAt)} · awaiting acceptance
                    </div>
                  </div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(link)}
                    className="btn-ghost"
                  >
                    <Copy size={12} /> Copy link
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
