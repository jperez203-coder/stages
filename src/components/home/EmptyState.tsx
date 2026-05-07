"use client";

import { Plus } from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";

type Props = {
  onNew: () => void;
  isOwner: boolean;
};

export function EmptyState({ onNew, isOwner }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-5"><StagesLogo size={64} /></div>
      <div className="text-xl font-semibold mb-2">
        {isOwner ? "No clients yet" : "No invitations yet"}
      </div>
      <div className="text-zinc-500 text-sm mb-6 max-w-sm">
        {isOwner
          ? "Create your first client workspace to start tracking their pipeline."
          : "When an owner invites you to a client, it will appear here."}
      </div>
      {isOwner && (
        <button onClick={onNew} className="btn-primary">
          <Plus size={15} strokeWidth={2.5} /> Add First Client
        </button>
      )}
    </div>
  );
}
