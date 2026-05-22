"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Edit-pipeline mode state — shared between PipelineHeader (toggle button)
 * and PipelineCanvas (visual treatment + drag affordances + inline rename).
 * Phase 4a step 5e.
 *
 * Mounted in `PipelineChromeShell` so it lives ABOVE both consumers (the
 * header is a sibling of `{children}` and the canvas is rendered as
 * `{children}`, so a shared parent is the natural home for the state).
 *
 * `canEditPipeline` is plumbed through the provider too so that consumers
 * don't have to also receive it as a prop — keeps the "can the user edit"
 * gate co-located with the "is the user currently editing" state.
 *
 * `editMode` is per-page-mount: route navigation to /clients (sibling
 * route in the same canvas group) creates a fresh shell + provider, so
 * navigating away and back resets edit mode to false. That's intentional
 * — edit mode belongs to the canvas surface, not to the user session.
 */

type EditModeContextValue = {
  editMode: boolean;
  setEditMode: (value: boolean) => void;
  toggleEditMode: () => void;
  canEditPipeline: boolean;
};

const EditModeContext = createContext<EditModeContextValue | null>(null);

export function EditModeProvider({
  canEditPipeline,
  children,
}: {
  canEditPipeline: boolean;
  children: ReactNode;
}) {
  const [editMode, setEditModeState] = useState(false);

  // Stable callbacks — consumers that depend on these via useEffect /
  // useCallback shouldn't re-fire just because some sibling re-rendered
  // the provider.
  const setEditMode = useCallback((value: boolean) => {
    setEditModeState(value);
  }, []);

  const toggleEditMode = useCallback(() => {
    setEditModeState((v) => !v);
  }, []);

  const value = useMemo<EditModeContextValue>(
    () => ({ editMode, setEditMode, toggleEditMode, canEditPipeline }),
    [editMode, setEditMode, toggleEditMode, canEditPipeline],
  );

  return (
    <EditModeContext.Provider value={value}>
      {children}
    </EditModeContext.Provider>
  );
}

/**
 * Consume edit-mode state. Throws if used outside the provider — preferred
 * over returning a default value because forgetting to wrap a new (canvas)
 * route in the shell would silently produce stuck-in-view-mode behavior,
 * which is harder to debug than a clear runtime error.
 */
export function useEditMode(): EditModeContextValue {
  const ctx = useContext(EditModeContext);
  if (!ctx) {
    throw new Error(
      "useEditMode must be used within an EditModeProvider " +
        "(mounted by PipelineChromeShell).",
    );
  }
  return ctx;
}
