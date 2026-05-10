"use client";

import { Plus, LogOut } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase } from "@/lib/supabase";

/**
 * Stub for step 4. The real "create your first workspace" form is built in
 * step 5 of Phase 3.4. For now, this page is just a landing target so users
 * with no contexts (fresh signups, post-cleanup test accounts) hit a
 * coherent screen instead of a 404.
 *
 * See supabase/PHASE_3_4_PLAN.md → step 5 for what this becomes.
 */
export default function CreateWorkspaceStubPage() {
  const signOut = () => {
    void supabase.auth.signOut();
  };

  return (
    <AuthShell
      title="Welcome to Stages"
      subtitle="Let's set up your first workspace."
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
          <Plus size={22} className="text-stages-blue" />
        </div>
        <p className="text-[14px] text-zinc-200 mb-1">Create your workspace</p>
        <p className="text-[13px] text-zinc-500 mb-5 leading-relaxed">
          The full workspace-creation form arrives in step 5 of Phase 3.4. For
          now, this is a stub so the post-login router has somewhere to land
          users with no contexts yet.
        </p>
        <button onClick={signOut} className="btn-ghost w-full justify-center">
          <LogOut size={14} />
          Sign out (for testing)
        </button>
      </div>
    </AuthShell>
  );
}
