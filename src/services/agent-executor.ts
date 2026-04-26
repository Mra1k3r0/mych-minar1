import { config } from "../config.js";
import type { LlmClient, ChatMessage, ToolDefinition, ToolCall } from "./llm.js";
import { normalizeToolOutput } from "./tool-output.js";
import { Parser } from "expr-eval";

const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate a mathematical expression. Supports basic arithmetic, exponents, trig, etc.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Math expression to evaluate, e.g. '2 + 2 * 3'",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datetime",
      description: "Get the current date, time, or timezone information.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone, e.g. 'Asia/Manila'. Defaults to UTC.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_text",
      description:
        "Generate structured text content like summaries, translations, code snippets, lists, etc.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "What to generate: 'summarize', 'translate', 'code', 'list', 'explain'",
          },
          input: { type: "string", description: "The source text or topic" },
          options: {
            type: "string",
            description:
              "Additional options, e.g. target language for translate, programming language for code",
          },
        },
        required: ["task", "input"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Store a key-value note in the current session for later recall.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Short label for the note" },
          value: { type: "string", description: "Content to remember" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Retrieve a previously stored note by key, or list all stored notes.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to look up. Omit to list all stored notes." },
        },
      },
    },
  },
];

interface AgentResult {
  response: string;
  toolsUsed: string[];
  toolCommands: string[];
  iterations: number;
  totalTokens: number;
}

export class AgentExecutor {
  private memory = new Map<number, Map<string, string>>();
  private readonly mathParser = new Parser({
    operators: {
      logical: false,
      comparison: false,
      assignment: false,
      in: false,
    },
  });

  constructor(private llm: LlmClient) {}

  async execute(userId: number, messages: ChatMessage[]): Promise<AgentResult> {
    const toolsUsed: string[] = [];
    const toolCommands: string[] = [];
    let totalTokens = 0;
    let iterations = 0;

    const systemMsg: ChatMessage = {
      role: "system",
      content: [
        config.bot.systemPrompt,
        "",
        "You are minar1 in AGENT mode. You have access to tools that you can call to help answer the user's request.",
        "Think step by step. Use tools when they would provide a better answer.",
        "After using tools, synthesize the results into a clear final response.",
      ].join("\n"),
    };

    const working: ChatMessage[] = [systemMsg, ...messages];

    while (iterations < config.bot.maxAgentIterations) {
      iterations++;

      const { message, usage } = await this.llm.chat(working, {
        tools: AGENT_TOOLS,
      });
      totalTokens += usage.total_tokens;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return {
          response: message.content,
          toolsUsed,
          toolCommands,
          iterations,
          totalTokens,
        };
      }

      working.push(message);

      for (const call of message.tool_calls) {
        const result = this.executeTool(userId, call);
        toolsUsed.push(call.function.name);
        toolCommands.push(`${call.function.name} ${call.function.arguments}`);
        working.push({
          role: "tool",
          content: await normalizeToolOutput(call.function.name, result),
          tool_call_id: call.id,
        });
      }
    }

    const final = await this.llm.chat([
      ...working,
      {
        role: "user",
        content: "Please provide your final answer based on all the tool results above.",
      },
    ]);
    totalTokens += final.usage.total_tokens;

    return {
      response: final.message.content,
      toolsUsed,
      toolCommands,
      iterations,
      totalTokens,
    };
  }

  private executeTool(userId: number, call: ToolCall): string {
    const { name, arguments: rawArgs } = call.function;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      return `Error: Invalid JSON arguments for tool ${name}`;
    }

    switch (name) {
      case "calculate":
        return this.toolCalculate(this.asStringArg(args.expression));
      case "datetime":
        return this.toolDatetime(this.asStringArg(args.timezone, "UTC"));
      case "generate_text":
        return this.toolGenerateText(
          this.asStringArg(args.task),
          this.asStringArg(args.input),
          this.asStringArg(args.options),
        );
      case "remember":
        return this.toolRemember(userId, this.asStringArg(args.key), this.asStringArg(args.value));
      case "recall":
        return this.toolRecall(userId, typeof args.key === "string" ? args.key : undefined);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private asStringArg(value: unknown, fallback = ""): string {
    if (typeof value === "string") return value;
    return fallback;
  }

  private toolCalculate(expression: string): string {
    const expr = expression.trim();
    if (expr.length > 200) return "Error: Expression too long (max 200 chars).";
    if (/\b(constructor|__proto__|prototype|process|require)\b/i.test(expr)) {
      return "Error: Security block: suspicious keywords detected.";
    }
    try {
      const result = this.mathParser.evaluate(expr);
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return `Error: Expression "${expr}" did not produce a valid number`;
      }
      return `Result: ${String(result)}`;
    } catch (err) {
      return `Error evaluating "${expr}": ${(err as Error).message}`;
    }
  }

  private toolDatetime(timezone: string): string {
    try {
      const now = new Date();
      const formatted = now.toLocaleString("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
      return `Current date/time in ${timezone}: ${formatted}\nUnix timestamp: ${String(now.getTime())}`;
    } catch {
      return `Invalid timezone: ${timezone}. Use IANA format like "America/New_York"`;
    }
  }

  private toolGenerateText(task: string, input: string, options: string): string {
    return `[generate_text result]\nTask: ${task}\nInput: ${input}\nOptions: ${options}\n(This tool delegates back to the LLM — synthesize the answer directly.)`;
  }

  private toolRemember(userId: number, key: string, value: string): string {
    let userMem = this.memory.get(userId);
    if (!userMem) {
      userMem = new Map();
      this.memory.set(userId, userMem);
    }
    userMem.set(key, value);
    return `Stored note "${key}" successfully.`;
  }

  private toolRecall(userId: number, key?: string): string {
    const userMem = this.memory.get(userId);
    if (!userMem || userMem.size === 0) {
      return "No notes stored yet.";
    }
    if (key) {
      const val = userMem.get(key);
      return val ? `${key}: ${val}` : `No note found with key "${key}"`;
    }
    const entries = [...userMem.entries()].map(([k, v]) => `• ${k}: ${v}`);
    return `Stored notes:\n${entries.join("\n")}`;
  }
}
