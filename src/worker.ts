import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { normalizeUrl, parseMaxFileMb } from "./config.js";
import { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

interface Env {
  MOODLE_URL: string;
  MOODLE_TOKEN: string;
  MCP_API_KEY: string;            // NEW : la clé que Mammouth enverra
  MOODLE_MCP_MAX_FILE_MB?: string;
}

// NEW : comparaison en temps constant (évite les attaques par mesure du temps)
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // NEW : refuser de démarrer sans clé configurée (fail closed)
    if (!env.MCP_API_KEY || env.MCP_API_KEY.length < 32) {
      return json(500, { error: "Server misconfigured" });
    }

    // NEW : vérification de la clé avant toute autre action
    const auth = request.headers.get("Authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!provided || !safeEqual(provided, env.MCP_API_KEY)) {
      return json(401, { error: "Unauthorized" });
    }

    // Message générique : ne plus révéler la configuration au public
    if (!env.MOODLE_URL || !env.MOODLE_TOKEN) {
      return json(500, { error: "Server misconfigured" });
    }

    try {
      const maxFileBytes = Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024);
      const client = await MoodleClient.create({
        baseUrl: normalizeUrl(env.MOODLE_URL),
        token: env.MOODLE_TOKEN,
        maxFileBytes,
      });
      const server = new McpServer({ name: "moodle-mcp", version: "0.2.0" });
      registerAllTools(server, client);
      registerResources(server, client);
      registerPrompts(server);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      return transport.handleRequest(request);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return json(502, { error: message });
    }
  },
};