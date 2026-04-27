import type { BaseContext } from "@mra1k3r0/gramora";

export interface CommandDef {
  name: string;
  description: string;
  group: "core" | "ai" | "admin" | "fun";
  admin?: boolean;
  perm?: number;
  cooldownSeconds?: number;
  run?: (gram: BaseContext) => Promise<void>;
}
