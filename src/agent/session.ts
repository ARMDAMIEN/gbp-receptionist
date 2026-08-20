import { query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_MODEL } from "../config.js";
import { SYSTEM_PROMPT } from "../prompt.js";
import { receptionistMcpServer } from "./tools.js";

type SDKUserMessage = {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
};

export interface AgentSessionCallbacks {
  onAssistantText: (text: string) => void;
  onAssistantDelta?: (delta: string) => void;
  onAssistantTextBlockEnd?: () => void;
  onToolUse?: (name: string) => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

// Wraps the Claude Agent SDK `query()` in streaming-input mode for a live
// phone call: each finalized user utterance is pushed via `sendUserTurn()`,
// and assistant text is streamed back through `onAssistantText` for TTS.
export class AgentSession {
  private queue: SDKUserMessage[] = [];
  private resolveNext: ((msg: SDKUserMessage | null) => void) | null = null;
  private finished = false;
  private sessionId: string;
  private started = false;

  constructor(
    private readonly callbacks: AgentSessionCallbacks,
    sessionId?: string
  ) {
    this.sessionId = sessionId ?? `call-${Date.now()}`;
  }

  private async *inputStream(): AsyncGenerator<SDKUserMessage> {
    while (!this.finished) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      const next = await new Promise<SDKUserMessage | null>((resolve) => {
        this.resolveNext = resolve;
      });
      if (next === null) return;
      yield next;
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.runLoop().catch((err) => this.callbacks.onError?.(err));
  }

  private async runLoop() {
    for await (const message of query({
      prompt: this.inputStream(),
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: CLAUDE_MODEL,
        mcpServers: { gbp_receptionist: receptionistMcpServer },
        tools: [],
        allowedTools: [
          "mcp__gbp_receptionist__book_appointment",
          "mcp__gbp_receptionist__notify_owner",
        ],
        permissionMode: "bypassPermissions",
        maxTurns: 200,
        includePartialMessages: true,
        sandbox: { enabled: false, failIfUnavailable: false },
      } as any,
    })) {
      const m = message as any;
      if (m.type === "stream_event" && m.event) {
        const ev = m.event;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          this.callbacks.onAssistantDelta?.(ev.delta.text ?? "");
        } else if (ev.type === "content_block_stop") {
          this.callbacks.onAssistantTextBlockEnd?.();
        }
      }
      if (m.type === "assistant" && m.message?.content) {
        for (const block of m.message.content) {
          if (block.type === "text" && block.text) {
            this.callbacks.onAssistantText(block.text);
          }
          if (block.type === "tool_use") {
            this.callbacks.onToolUse?.(block.name);
          }
        }
      }
      if (m.type === "result") {
        this.callbacks.onDone?.();
      }
    }
  }

  sendUserTurn(text: string) {
    if (this.finished) return;
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    };
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r(msg);
    } else {
      this.queue.push(msg);
    }
  }

  end() {
    this.finished = true;
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r(null);
    }
  }
}
