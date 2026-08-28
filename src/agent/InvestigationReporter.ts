import type { CheckpointState, TaskMode } from "../config/types.js";
import type { TaskRecord } from "../persistence/Database.js";
import type { OllamaClient } from "../ollama/OllamaClient.js";
import { getInvestigationReportPrompt } from "./prompts/system.js";

export interface ReportContext {
  task: TaskRecord;
  state: CheckpointState;
  toolCalls: Array<{ tool_name: string; result_preview: string | null }>;
  workSummary?: string;
}

export class InvestigationReporter {
  constructor(private ollama: OllamaClient) {}

  async generate(ctx: ReportContext): Promise<string> {
    const evidence = this.formatEvidence(ctx);
    const response = await this.ollama.chat([
      {
        role: "system",
        content:
          "You write detailed markdown investigation reports for software developers. Be specific, cite files and evidence, and separate facts from recommendations.",
      },
      {
        role: "user",
        content: getInvestigationReportPrompt({
          title: ctx.task.title,
          description: ctx.task.description,
          mode: ctx.task.mode as TaskMode,
          plan: ctx.state.plan,
          filesExamined: ctx.state.filesExamined,
          decisions: ctx.state.decisions,
          evidence,
          workSummary: ctx.workSummary,
        }),
      },
    ]);

    const report = response.message.content.trim();
    if (!report) {
      return this.fallbackReport(ctx);
    }
    return report;
  }

  private formatEvidence(ctx: ReportContext): string {
    if (ctx.toolCalls.length === 0) {
      return ctx.workSummary?.trim() || "No tool evidence captured.";
    }

    return ctx.toolCalls
      .map((call, index) => {
        const preview = call.result_preview?.slice(0, 2000) ?? "(no output)";
        return `${index + 1}. ${call.tool_name}\n${preview}`;
      })
      .join("\n\n");
  }

  private fallbackReport(ctx: ReportContext): string {
    return [
      `# Investigation Report: ${ctx.task.title}`,
      "",
      "## Summary",
      "The agent completed exploration but did not produce a narrative report.",
      "",
      "## Task",
      ctx.task.description,
      "",
      ctx.state.plan ? `## Plan\n${ctx.state.plan}` : "",
      ctx.state.filesExamined.length
        ? `## Files Examined\n${ctx.state.filesExamined.map((f) => `- ${f}`).join("\n")}`
        : "",
      "## Evidence",
      this.formatEvidence(ctx),
    ]
      .filter(Boolean)
      .join("\n");
  }
}
