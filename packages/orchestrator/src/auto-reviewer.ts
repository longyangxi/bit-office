/**
 * Auto-reviewer — decides when to trigger review and builds review prompts.
 * Used by orchestrator to automatically queue review tasks after dev completion.
 */

const MAX_DIFF_CHARS = 6000;

export interface AutoReviewCheck {
  autoReview: boolean;
  role: string;
  isTeamLead: boolean;
  hasReviewer: boolean;
}

/**
 * Should this task:done trigger an auto-review?
 */
export function shouldAutoReview(check: AutoReviewCheck): boolean {
  if (!check.autoReview) return false;
  if (check.isTeamLead) return false;
  if (!check.hasReviewer) return false;
  if (check.role.toLowerCase().includes("review")) return false;
  return true;
}

export interface ReviewPromptInput {
  changedFiles: string[];
  summary: string;
  entryFile?: string;
  diff: string;
  devName: string;
  devTaskId: string;
}

/**
 * Build a review prompt from dev task results.
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  const { changedFiles, summary, entryFile, diff, devName, devTaskId } = input;

  const fileList = changedFiles.map(f => `- ${f}`).join("\n");

  let diffSection: string;
  if (diff.length > MAX_DIFF_CHARS) {
    diffSection = `\n===== DIFF (truncated — ${diff.length} chars total) =====\n${diff.slice(0, MAX_DIFF_CHARS)}\n... (truncated — use Read tool to see full files)`;
  } else if (diff) {
    diffSection = `\n===== DIFF =====\n${diff}`;
  } else {
    diffSection = "\n(No diff available — read the files to review)";
  }

  return [
    `Auto-review of ${devName}'s work (task: ${devTaskId}).`,
    `Review the code changes below. Focus on the DIFF for what changed, Read files only if you need surrounding context.`,
    `Only flag real bugs, crashes, security issues, logic errors. Skip style/naming suggestions.`,
    ``,
    `Files changed:\n${fileList}`,
    entryFile ? `Entry: ${entryFile}` : "",
    summary ? `Summary: ${summary}` : "",
    diffSection,
  ].filter(Boolean).join("\n");
}
