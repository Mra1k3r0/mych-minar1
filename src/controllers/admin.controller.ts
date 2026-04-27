import { Controller, Command } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { commandRegistry } from "../commands/index.js";

@Controller()
export class AdminController {
  @Command("stats")
  async stats(gram: BaseContext) {
    await commandRegistry.run("stats", gram);
  }

  @Command("status")
  async status(gram: BaseContext) {
    await commandRegistry.run("status", gram);
  }

  @Command("restart")
  async restart(gram: BaseContext) {
    await commandRegistry.run("restart", gram);
  }
}
