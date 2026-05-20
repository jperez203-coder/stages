/**
 * Shared shapes between the server page and the client view for
 * /w/[slug]/my-tasks. Kept in a separate file so the server page can
 * import types without importing the client component bundle.
 */

export type TaskWithMeta = {
  id: string;
  title: string;
  deadline: string | null;
  completedAt: string | null;
  done: boolean;
  createdAt: string;
  stage: {
    id: string;
    name: string;
    color: string | null;
    position: number;
    pipelineId: string;
    pipelineName: string;
    pipelineEmoji: string | null;
  };
};

export type PipelineLite = {
  id: string;
  name: string;
  emoji: string | null;
  /** Derived current stage id per the locked 3-state rule. Null when the
   *  pipeline has no stages. Quick-add lands tasks here when the user
   *  picks this pipeline. */
  currentStageId: string | null;
};
