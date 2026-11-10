/**
 * Integration test: the synced pi-config-sync location
 * (<PI_CODING_AGENT_DIR>/.hindsight/config) drives the real extension hooks.
 *
 * Uses @marcfargas/pi-test-harness so no model, network or real Hindsight
 * server is involved.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createTestSession, type TestSession } from "@marcfargas/pi-test-harness";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const EXTENSION = path.resolve(__dirname, "../index.ts");
const API_URL = "http://localhost:19877";

describe("pi agent dir config drives hooks", () => {
  let t: TestSession;
  let tmp: string;
  let originalFetch: typeof globalThis.fetch;
  let originalHome: string | undefined;
  let originalAgentDir: string | undefined;
  let fetchUrls: string[];

  beforeEach(() => {
    fetchUrls = [];
    originalFetch = globalThis.fetch;
    originalHome = process.env.HOME;
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-config-test-"));
    const home = path.join(tmp, "home");
    const agentDir = path.join(tmp, "agent");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(path.join(agentDir, ".hindsight"), { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, ".hindsight", "config"),
      [
        `api_url = "${API_URL}"`,
        'api_key = "agent-key"',
        'project_bank_id = "agent-bank"',
      ].join("\n"),
    );

    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchUrls.push(url);

      if (url.endsWith("/health")) return new Response("{}", { status: 200 });
      if (init?.method === "PATCH" && url.includes("/config")) {
        return new Response(JSON.stringify({ config: {} }), { status: 200 });
      }
      if (url.includes("/config")) {
        return new Response(JSON.stringify({ config: {} }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });
  });

  afterEach(() => {
    t?.dispose();
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("uses the agent-dir api_url and bank during session_start", async () => {
    t = await createTestSession({ extensions: [EXTENSION] });

    // session_start fires warm-up and mission setup without blocking the hook.
    await vi.waitFor(() => {
      expect(fetchUrls).toContain(`${API_URL}/health`);
      expect(fetchUrls.some((url) => url.includes("/banks/agent-bank/config"))).toBe(true);
    });
  });
});
