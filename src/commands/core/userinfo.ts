import { commandRegistry } from "../registry.js";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const CMD_USERINFO = commandRegistry.register({
  name: "userinfo",
  description: "Show profile info (you or replied user)",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    const msg = asRecord((gram as unknown as UnknownRecord).message);
    const replied = asRecord(asRecord(msg?.reply_to_message)?.from);
    const from = asRecord(msg?.from);
    const target = replied ?? from;

    const id = getNumber(target?.id);
    const username = getString(target?.username);
    const firstName = getString(target?.first_name);
    const lastName = getString(target?.last_name);
    const isBot = target?.is_bot === true;

    await gram.send(
      [
        "👤 *User Info*",
        `ID: \`${String(id ?? gram.fromId ?? "n/a")}\``,
        `Username: @${username ?? "none"}`,
        `First name: ${firstName ?? "unknown"}`,
        `Last name: ${lastName ?? "none"}`,
        `Type: ${isBot ? "bot" : "user"}`,
      ].join("\n"),
    );
  },
});
