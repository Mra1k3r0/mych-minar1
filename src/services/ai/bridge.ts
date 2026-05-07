import type { BaseContext } from "@mra1k3r0/gramora";

export type AiCommandRunner = (gram: BaseContext) => Promise<void>;

export const aiCommandBridge: {
  ask?: AiCommandRunner;
  chat?: AiCommandRunner;
  agent?: AiCommandRunner;
  clear?: AiCommandRunner;
} = {};
