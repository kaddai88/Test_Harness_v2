/**
 * MCP Native Tool Adapter — thin bridge from Playwright MCP tools to our Tool interface.
 *
 * Instead of wrapping MCP tools in our own abstractions (click_element → MCP browser_click),
 * this module exposes MCP's native tools directly to the LLM. The LLM sees and calls
 * browser_snapshot, browser_click, browser_fill_form, etc. — the same tools that
 * Playwright MCP's official clients use.
 *
 * Benefits:
 * - Aria snapshot (browser_snapshot) replaces distillDom + observe_page
 * - ref-based element targeting replaces CSS selector guessing
 * - Auto-snapshot after actions replaces manual observe_page calls
 * - Native iframe support via aria tree (no crossFrameAction needed)
 * - battle-tested tools from Microsoft instead of our JS injection hacks
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// ─── MCP Client Manager ───
// Single shared MCP client connection for all tool adapters.

let mcpClient: Client | null = null;
let mcpConnectPromise: Promise<Client> | null = null;

export async function getMCPClient(serverUrl = "http://localhost:3001/sse"): Promise<Client> {
  if (mcpClient) return mcpClient;
  if (mcpConnectPromise) return mcpConnectPromise;

  mcpConnectPromise = (async () => {
    const client = new Client(
      { name: "test-harness", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport = new SSEClientTransport(new URL(serverUrl));
    await client.connect(transport);
    mcpClient = client;
    mcpConnectPromise = null;
    console.log("[MCPTools] Connected to Playwright MCP server at", serverUrl);
    return client;
  })();

  return mcpConnectPromise;
}

export async function closeMCPClient(): Promise<void> {
  if (mcpClient) {
    try { await mcpClient.close(); } catch { /* ignore */ }
    mcpClient = null;
  }
  mcpConnectPromise = null;
}

/**
 * Close the browser via MCP browser_close tool.
 * Call this when a session completes to prevent orphan browser windows.
 */
export async function closeBrowser(serverUrl = "http://localhost:3001/sse"): Promise<void> {
  try {
    const client = await getMCPClient(serverUrl);
    await client.callTool({
      name: "browser_close",
      arguments: {},
    });
    console.log("[MCPTools] Browser closed via browser_close");
  } catch (err) {
    console.warn("[MCPTools] Failed to close browser:", err);
  }
}

// ─── MCP Tool Discovery ───

interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Fetch all available tools from the MCP server.
 */
export async function fetchMCPToolSchemas(serverUrl = "http://localhost:3001/sse"): Promise<MCPToolSchema[]> {
  const client = await getMCPClient(serverUrl);
  const result = await client.listTools();
  return result.tools.map((t: any) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as Record<string, unknown> | undefined,
  }));
}

// ─── MCP Tool → Our Tool Adapter ───

/**
 * Create a Tool adapter for a single MCP tool.
 * 
 * The adapter:
 * - Uses the MCP tool's JSON Schema directly (rawJsonSchema) for LLM consumption
 * - Uses z.any() for input validation (MCP server validates its own schema)
 * - Proxies execute() calls to the MCP server via callTool()
 * - Transforms MCP results into our ToolResult format
 */
function createMCPToolAdapter(
  mcpTool: MCPToolSchema,
  serverUrl: string,
): Tool {
  // Determine concurrency: read-only tools are safe to parallelize
  const readOnlyPatterns = ["snapshot", "console_messages", "network_requests", "network_request",
    "cookie_list", "cookie_get", "localstorage_list", "localstorage_get", "find", "get_config"];
  const isReadOnly = readOnlyPatterns.some(p => mcpTool.name.includes(p));

  return {
    id: mcpTool.name,
    name: mcpTool.name,
    description: mcpTool.description || `Playwright MCP tool: ${mcpTool.name}`,
    category: "browser",
    // Permissive Zod schema — MCP server does real validation
    inputSchema: z.any().optional(),
    outputSchema: z.any(),
    // Pass through the MCP JSON Schema for the LLM
    rawJsonSchema: mcpTool.inputSchema ?? { type: "object", properties: {} },
    timeoutMs: 30_000,
    isConcurrencySafe: () => isReadOnly,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const start = Date.now();
      try {
        const client = await getMCPClient(serverUrl);
        const args = (input ?? {}) as Record<string, unknown>;
        const result = await client.callTool({ name: mcpTool.name, arguments: args });

        // Transform MCP result → our ToolResult
        const isError = result?.isError === true;
        const content = result?.content ?? [];

        // Extract text from content array
        let text = "";
        const images: Array<{ data: string; mimeType: string }> = [];
        const contentArr = Array.isArray(content) ? content : [];
        for (const item of contentArr) {
          if ((item as any).type === "text") {
            text += (item as any).text ?? "";
          } else if ((item as any).type === "image") {
            images.push({
              data: (item as any).data ?? "",
              mimeType: (item as any).mimeType ?? "image/png",
            });
          }
        }

        if (isError) {
          return {
            success: false,
            error: text.slice(0, 500),
            duration: Date.now() - start,
          };
        }

        return {
          success: true,
          data: {
            text,
            images: images.length > 0 ? images : undefined,
          },
          duration: Date.now() - start,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        };
      }
    },
  };
}

// ─── Tool Registration ───

/**
 * Fetch MCP tools and create adapters for ALL of them.
 * No filtering — we use everything Playwright MCP provides.
 * 
 * @param serverUrl MCP server URL
 */
export async function createMCPNativeTools(
  serverUrl = "http://localhost:3001/sse",
): Promise<Tool[]> {
  const mcpTools = await fetchMCPToolSchemas(serverUrl);
  const tools: Tool[] = [];

  for (const mcpTool of mcpTools) {
    tools.push(createMCPToolAdapter(mcpTool, serverUrl));
    // Per-tool registration is debug noise; summary logged below
    if ((process.env.TH_LOG_LEVEL ?? "").toLowerCase() === "debug") {
      console.log(`[MCPTools] Registered: ${mcpTool.name}`);
    }
  }

  console.log(`[MCPTools] ${tools.length} tools registered from Playwright MCP`);
  return tools;
}
