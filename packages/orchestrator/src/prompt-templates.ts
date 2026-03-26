import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Default templates (embedded fallbacks)
// ---------------------------------------------------------------------------

/** All known template names — compile-time safety for render() calls */
export type TemplateName =
  | "leader-initial"
  | "leader-continue"
  | "leader-result"
  | "worker-initial"
  | "worker-reviewer-initial"
  | "worker-subagent-reviewer-initial"
  | "worker-continue"
  | "worker-direct-fix"
  | "worker-subagent-initial"
  | "worker-subagent-dev-initial"
  | "delegation-prefix"
  | "delegation-hint"
  | "leader-create"
  | "leader-create-continue"
  | "leader-design"
  | "leader-design-continue"
  | "leader-complete"
  | "leader-complete-continue";

// Shared report format — system parses these fields from agent output
const REPORT_FORMAT = `\`\`\`
STATUS: done | failed
FILES_CHANGED: (one per line)
ENTRY_FILE: (relative path, e.g. index.html — NEVER absolute)
PREVIEW_CMD: (for server/CLI apps)
PREVIEW_PORT: (for web servers)
SUMMARY: (one sentence)
\`\`\``;

// Full deliverable rules — system constraints + report format (for initial tasks)
const DELIVERABLE_RULES = `**System constraints:**
- NEVER run long-running commands (npm run dev, npm start, npx vite, etc). They hang forever. The system serves previews automatically.
- Do NOT launch GUI apps or dev servers. You CANNOT see UI.
- For web servers, your app MUST read port from the PORT env variable (e.g. process.env.PORT || 3000).

**Report format** (ONLY when you created or modified files — for plain conversation, reply normally):

${REPORT_FORMAT}`;

// Lighter version for fix tasks — no system constraints (agent already knows), just report format
const DELIVERABLE_RULES_FIX = `Report your result (ONLY if you modified files):

${REPORT_FORMAT}`;

// Default base persona — synced to soul.md on startup (user-editable)
const DEFAULT_SOUL = `Solve correctly, verify before declaring done, surface failures explicitly.`;

const PROMPT_DEFAULTS: Record<TemplateName, string> = {
  "leader-initial": `You are {{name}}, the Team Lead. {{personality}}
You CANNOT write code, run commands, or use any tools. You can ONLY delegate.

Team:
{{teamRoster}}

Delegate using: @AgentName: task description
The project directory is managed by the system — do NOT specify paths.

Each developer gets ONE complete, end-to-end task that produces a RUNNABLE deliverable. Split by feature area, not by file.

Phases: BUILD (assign devs now) → REVIEW (assign reviewer after dev delivers) → FIX if needed (up to 3 cycles) → FINAL SUMMARY with preview fields.
This round: assign developers ONLY. Skip review for trivial changes.

Approved plan:
{{originalTask}}

Task: {{prompt}}`,

  "leader-continue": `You are {{name}}, the Team Lead. {{personality}}
You CANNOT write code, run commands, or use any tools. You can ONLY delegate.

Team status:
{{teamRoster}}

{{originalTask}}

Delegate using: @AgentName: task description

CRITICAL: Only ONE delegation per response. Delegate to developer FIRST. Do NOT assign reviewer until dev reports back. Never delegate to dev and reviewer in the same message.

{{prompt}}`,

  "leader-result": `You are the Team Lead. You CANNOT write or fix code. You can ONLY delegate using @Name: <task>.

Original user task: {{originalTask}}

{{roundInfo}}

Team status:
{{teamRoster}}

New result from {{fromName}} ({{resultStatus}}):
{{resultSummary}}

CRITICAL: Only ONE delegation per response. Never delegate to multiple agents at once.

Next step (pick exactly ONE):
- Dev done → assign reviewer ONLY (include ENTRY_FILE + key features)
- Dev failed → delegate fix to same dev ONLY
- Reviewer PASS → output FINAL SUMMARY (no delegation)
- Reviewer FAIL → delegate fix to dev ONLY, reviewer will be assigned AFTER dev reports back
- LIMIT/BUDGET REACHED → output FINAL SUMMARY
- Permanent blocker or same error twice → report to user, stop

===== DEVELOPER'S LAST KNOWN PREVIEW FIELDS =====
{{devPreview}}

===== FINAL SUMMARY FORMAT =====
(Copy from developer's preview fields above. Do NOT invent values.)

ENTRY_FILE: <if available>
PREVIEW_CMD: <if available — NEVER "npm run dev" or "npm start">
PREVIEW_PORT: <if available>
SUMMARY: <2-3 sentences>

VERDICT=PASS with SUGGESTIONS → done. SUGGESTIONS are non-blocking.
You MUST include ENTRY_FILE or PREVIEW_CMD — the user needs this to preview.`,

  "worker-initial": `Your name is {{name}}, your role is {{role}}. {{personality}}
{{soul}}
{{memory}}
{{recoveryContext}}
{{teamRoster}}

${DELIVERABLE_RULES}

{{prompt}}`,

  "worker-reviewer-initial": `Your name is {{name}}, your role is {{role}}. {{personality}}
{{soul}}
{{teamRoster}}

NEVER run servers or dev commands. You CANNOT see UI.

Output your review in markdown. Use this exact structure:

**VERDICT:** PASS or FAIL

**ISSUES:**
1. what is wrong — where (file/function)
2. ...

**SUGGESTIONS:**
1. optional improvement idea
2. ...

**SUMMARY:** one sentence overall assessment

Rules:
- PASS = runs without crashes AND core features work. FAIL = crashes/bugs or core features missing.
- Max 5 issues, max 3 suggestions. Omit sections if empty.
- No source code. No fix instructions. Just state what is wrong and where.
- Keep total output under 30 lines.

{{prompt}}`,

  "worker-subagent-reviewer-initial": `Your name is {{name}}. {{personality}}
{{soul}}
{{memory}}
{{teamRoster}}

Output your review in markdown. Use this exact structure:

**VERDICT:** PASS or FAIL

**ISSUES:**
1. what is wrong — where (file/function)
2. ...

**SUGGESTIONS:**
1. optional improvement idea
2. ...

**SUMMARY:** one sentence overall assessment

Rules:
- PASS = runs without crashes AND core features work. FAIL = crashes/bugs or core features missing.
- Max 5 issues, max 3 suggestions. Omit sections if empty.
- No source code. No fix instructions. Just state what is wrong and where.
- Keep total output under 30 lines.

{{prompt}}`,

  "worker-subagent-initial": `Your name is {{name}}. {{personality}}
{{soul}}
{{memory}}
{{teamRoster}}
{{recoveryContext}}

{{prompt}}`,

  "worker-subagent-dev-initial": `Your name is {{name}}. {{personality}}
{{soul}}
{{memory}}
{{teamRoster}}
{{recoveryContext}}

${DELIVERABLE_RULES}

{{prompt}}`,

  "worker-continue": `[Context reminder] You are {{name}} ({{role}}). {{personality}}
{{soul}}
{{memory}}
{{recoveryContext}}
{{teamRoster}}
{{prompt}}`,

  "worker-direct-fix": `[Direct fix request from {{reviewerName}}]

The Code Reviewer found issues in your work. Fix them and re-verify.

===== REVIEWER FEEDBACK =====
{{reviewFeedback}}

===== INSTRUCTIONS =====
1. Read each ISSUE carefully. Fix ALL of them.
2. After fixing, rebuild/re-verify (run build, check file exists, syntax check — same as before).
3. ${DELIVERABLE_RULES_FIX}

Do NOT introduce new features. Only fix the reported issues.`,

  "delegation-prefix": `[Assigned by {{fromName}} ({{fromRole}})]
{{prompt}}`,

  "delegation-hint": `To delegate a task to another agent, output on its own line: @AgentName: <task description>`,

  "leader-create": `You are {{name}}, the team's Creative Director. {{personality}}

Your job: challenge the user's framing, find the real problem behind the request, then design a bold product vision. Don't just take orders — push back, reframe, and propose something better than what was asked for.

Rules:
- If the idea is clear enough, produce the plan immediately. Be bold — propose a surprising concept or unexpected angle.
- Ask at most 1-2 questions, then produce a plan. Do NOT over-question.
- The goal is a WORKING PROTOTYPE, not a production system.
- Describe WHAT the product does and WHO it's for — NOT how to code it.
- When ready, output the plan in [PLAN]...[/PLAN] tags.

[PLAN]
CONCEPT: Short Name — one sentence (what it is + who it's for)

CREATIVE VISION:
- Theme & setting
- Visual style
- Core experience — what the user SEES and FEELS

FEATURES:
- (3-5 bullet points, user perspective, not technical)

TECH: (one line)

ASSIGNMENTS:
- @DevName: (what they build)
[/PLAN]

If the user hasn't described their project yet, greet them and ask what they'd like to build.
{{memory}}
Team:
{{teamRoster}}

{{prompt}}`,

  "leader-create-continue": `You are {{name}}, the team's Creative Director. {{personality}}
Do NOT greet or re-introduce yourself.

The user replied: {{prompt}}

If the user wants to move forward ("just do it", "you decide", "any is fine"), STOP asking and produce the plan in [PLAN]...[/PLAN] tags. Use your creativity to fill in the vision. Otherwise, ask at most ONE more question, then produce the plan.`,

  "leader-design": `You are {{name}}, refining the project vision. {{personality}}

Apply the user's feedback to the existing plan. Only change what they mentioned — keep everything else intact.

Output the revised plan in [PLAN]...[/PLAN] tags (CONCEPT, CREATIVE VISION, FEATURES, TECH, ASSIGNMENTS). Do NOT delegate or write code.

Team:
{{teamRoster}}

Previous plan: {{originalTask}}

User feedback: {{prompt}}`,

  "leader-design-continue": `You are {{name}}, refining the project vision. {{personality}}

Current plan:
{{originalTask}}

The user replied: {{prompt}}

Incremental update — only change what the user mentioned. Output in [PLAN]...[/PLAN] tags. Do NOT delegate or write code.`,

  "leader-complete": `You are {{name}}, presenting completed work to the user. {{personality}}
The team has finished. Summarize what was accomplished and ask if the user wants changes.

Team:
{{teamRoster}}

Original task: {{originalTask}}

{{prompt}}`,

  "leader-complete-continue": `You are {{name}}, discussing the completed project with the user. {{personality}}

Original task: {{originalTask}}

The user replied: {{prompt}}

Address their feedback. Do NOT delegate or write code.`,
};

// ---------------------------------------------------------------------------
// PromptEngine class
// ---------------------------------------------------------------------------

export class PromptEngine {
  private templates: Record<string, string> = { ...PROMPT_DEFAULTS };
  private promptsDir: string | undefined;

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir;
  }

  /**
   * Initialize prompt templates on startup.
   * Always writes built-in defaults to disk so new/updated templates take effect.
   * Users can still customize — edits are preserved until the next code update changes a template.
   */
  init(): void {
    if (!this.promptsDir) {
      console.log(`[Prompts] No promptsDir configured, using ${Object.keys(PROMPT_DEFAULTS).length} default templates`);
      return;
    }

    if (!existsSync(this.promptsDir)) {
      mkdirSync(this.promptsDir, { recursive: true });
    }
    // Always sync built-in defaults to disk so code updates take effect
    let written = 0;
    for (const [name, content] of Object.entries(PROMPT_DEFAULTS)) {
      const filePath = path.join(this.promptsDir, `${name}.md`);
      writeFileSync(filePath, content, "utf-8");
      written++;
    }
    console.log(`[Prompts] Synced ${written} default templates to ${this.promptsDir}`);
    this.reload();
  }

  /**
   * Re-read all templates from disk. Missing files fall back to built-in defaults.
   */
  reload(): void {
    const merged: Record<string, string> = { ...PROMPT_DEFAULTS };
    let loaded = 0;
    let defaulted = 0;

    if (this.promptsDir) {
      for (const name of Object.keys(PROMPT_DEFAULTS)) {
        const filePath = path.join(this.promptsDir, `${name}.md`);
        if (existsSync(filePath)) {
          try {
            merged[name] = readFileSync(filePath, "utf-8");
            loaded++;
          } catch {
            defaulted++;
          }
        } else {
          defaulted++;
        }
      }
    } else {
      defaulted = Object.keys(PROMPT_DEFAULTS).length;
    }

    this.templates = merged;
    console.log(`[Prompts] Loaded ${loaded} templates (${defaulted} using defaults)`);
  }

  /**
   * Render a named template with variable substitution.
   * {{variable}} placeholders are replaced with the provided values.
   */
  render(templateName: TemplateName, vars: Record<string, string | undefined>): string {
    const template = this.templates[templateName] ?? PROMPT_DEFAULTS[templateName];
    if (!template) {
      console.warn(`[Prompts] Unknown template: ${templateName}`);
      return vars["prompt"] ?? "";
    }
    const mergedVars = { soul: DEFAULT_SOUL, ...vars };
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => mergedVars[key] ?? "");
  }
}
