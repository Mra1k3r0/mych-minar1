export interface CommandDef {
  name: string;
  description: string;
  group: "core" | "ai" | "admin" | "fun";
}
