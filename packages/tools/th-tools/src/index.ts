/**
 * @test-harness/th-tools
 *
 * Tool framework — registration, execution, and built-in tools.
 */
import { THPlugin, THContainer } from "@test-harness/th-core";
import { ToolRegistry } from "./registry.js";
import { createHttpRequestTool } from "./builtins/http-request.js";
import { createClickElementTool } from "./builtins/click-element.js";
import { createFillFormTool } from "./builtins/fill-form.js";
import { createNavigateToTool } from "./builtins/navigate-to.js";
import { createTakeScreenshotTool } from "./builtins/take-screenshot.js";
import { createMeasurePerformanceTool } from "./builtins/measure-performance.js";
import { createAssertVisibleTool } from "./builtins/assert-visible.js";
import { createAssertTextTool } from "./builtins/assert-text.js";
import { createReportFindingTool } from "./builtins/report-finding.js";
import { createBrowserEvaluateTool } from "./builtins/browser-evaluate.js";
import { createFindElementTool } from "./builtins/find-element.js";
import { createObservePageTool } from "./builtins/observe-page.js";
import { createExtractDataTool } from "./builtins/extract-data.js";
import { createExploreSiteTool } from "./builtins/explore-site.js";
import { createConfigureSiteTool } from "./builtins/configure-site.js";
import { BrowserDriverDefinition } from "@test-harness/th-browser";
import { createMCPNativeTools } from "./builtins/mcp-tools.js";
import type { Tool } from "@test-harness/th-protocol";

export { ToolRegistry } from "./registry.js";
export { createHttpRequestTool } from "./builtins/http-request.js";
export { createClickElementTool } from "./builtins/click-element.js";
export { createFillFormTool } from "./builtins/fill-form.js";
export { createNavigateToTool } from "./builtins/navigate-to.js";
export { createTakeScreenshotTool } from "./builtins/take-screenshot.js";
export { createMeasurePerformanceTool } from "./builtins/measure-performance.js";
export { createAssertVisibleTool } from "./builtins/assert-visible.js";
export { createAssertTextTool } from "./builtins/assert-text.js";
export { createReportFindingTool } from "./builtins/report-finding.js";
export { createExecuteJsTool } from "./builtins/execute-js.js";
export { createFindElementTool } from "./builtins/find-element.js";
export { createObservePageTool } from "./builtins/observe-page.js";
export { createExtractDataTool } from "./builtins/extract-data.js";
export { createExploreSiteTool } from "./builtins/explore-site.js";
export { createConfigureSiteTool } from "./builtins/configure-site.js";
export { createMCPNativeTools, getMCPClient, closeMCPClient, closeBrowser } from "./builtins/mcp-tools.js";

/** Build the full set of built-in tools for a container. */
export function createAllTools(container: THContainer): Tool[] {
  const tools: Tool[] = [
    createHttpRequestTool(),
  ];

  // Register browser tools only if BrowserDriver is available in container
  try {
    container.get(BrowserDriverDefinition);
    tools.push(
      createClickElementTool(container),
      createFillFormTool(container),
      createNavigateToTool(container),
      createTakeScreenshotTool(container),
      createMeasurePerformanceTool(container),
      createAssertVisibleTool(container),
      createAssertTextTool(container),
      createBrowserEvaluateTool(container),
      createFindElementTool(container),
      createObservePageTool(container),
      createExtractDataTool(container),
      createExploreSiteTool(container),
      createConfigureSiteTool(container),
      // createExecuteJsTool(container), // Disabled: agent was abusing it
    );
  } catch {
    // BrowserDriver not available — skip browser tools
  }

  return tools;
}

/**
 * Build tools for MCP-native mode.
 * 
 * Exposes Playwright MCP's native tools directly to the LLM.
 * The LLM uses browser_snapshot, browser_click, browser_fill_form, etc.
 * No wrapper layer — direct MCP protocol.
 * 
 * @param mcpServerUrl MCP server URL (default: http://localhost:3001/sse)
 */
export async function createMCPModeTools(
  mcpServerUrl = "http://localhost:3001/sse",
): Promise<Tool[]> {
  const tools: Tool[] = [
    createHttpRequestTool(),
  ];

  // Add MCP native browser tools — direct from Playwright MCP server
  const mcpTools = await createMCPNativeTools(mcpServerUrl);
  tools.push(...mcpTools);

  // Add site knowledge tools (don't need BrowserDriver, file-based only)
  // configure_site: manual site profile configuration
  // explore_site is NOT added — LLM explores via browser_snapshot in MCP mode
  const emptyContainer = new THContainer();
  tools.push(createConfigureSiteTool(emptyContainer));

  return tools;
}

/** Plugin that registers the tool framework and built-in tools */
export class ToolsPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-tools",
    version: "0.1.0",
    description: "Tool framework and built-in tools",
  };

  private registry?: ToolRegistry;

  constructor() {
    super();
  }

  override activate(container: THContainer): void {
    this.registry = new ToolRegistry();

    // Register built-in tools
    for (const tool of createAllTools(container)) {
      this.registry.register(tool);
    }
  }

  override deactivate(): void {
    this.registry = undefined;
  }

  getRegistry(): ToolRegistry | undefined {
    return this.registry;
  }
}
