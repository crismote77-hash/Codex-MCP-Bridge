import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { runSetupWizard } from "../src/setupWizard.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "codex-mcp-bridge-"));
}

describe("setup wizard", () => {
  it("writes non-interactive config without storing apiKey", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config.json");

    await runSetupWizard({
      configPath,
      nonInteractive: true,
      authMode: "api_key",
      transport: "stdio",
      model: "o3",
    });

    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect((parsed.auth as Record<string, unknown>).mode).toBe("api_key");
    expect((parsed.transport as Record<string, unknown>).mode).toBe("stdio");
    expect((parsed.auth as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it("merges into an existing config by default", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ limits: { maxTokensPerDay: 123 } }, null, 2) + "\n",
      "utf8",
    );

    await runSetupWizard({
      configPath,
      nonInteractive: true,
      authMode: "cli",
      transport: "stdio",
      model: "o3",
    });

    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect((parsed.limits as Record<string, unknown>).maxTokensPerDay).toBe(123);
    expect((parsed.auth as Record<string, unknown>).mode).toBe("cli");
  });
});
