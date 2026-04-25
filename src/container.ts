import "./commands/index.js";
import { createLlmClient } from "./services/llm.js";
import { ConversationManager } from "./services/conversation.js";
import { AgentExecutor } from "./services/agent-executor.js";
import { CommandMetrics } from "./services/observability/metrics.js";

export const llm = createLlmClient();
export const conversations = new ConversationManager();
export const agentExecutor = new AgentExecutor(llm);
export const commandMetrics = new CommandMetrics();
