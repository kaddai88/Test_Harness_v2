/**
 * Tool service definition + registry with 3-stage execution pipeline.
 *
 * Execution pipeline:
 *   prepare()   → validate input + create execution context
 *   dispatch()  → execute tool with timeout control
 *   finalize()  → format result + compute duration
 *
 * Each stage is interceptable via waterfall events in the Agent Loop.
 */
import { defineService, type THContainer } from "@test-harness/th-core";
import type {
  AbortReason,
  Tool,
  ToolContext,
  ToolResult,
  ToolSchema,
} from "@test-harness/th-protocol";
import { extractAbortReason } from "@test-harness/th-protocol";

export const ToolServiceDefinition = defineService<Tool>("Tool");

/** Default tool timeout */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Prepared execution context (output of prepare stage) */
export interface PreparedExecution {
  tool: Tool;
  validatedInput: unknown;
  context: ToolContext;
  timeoutMs: number;
}

/**
 * ToolRegistry — manages tool registration, lookup, and 3-stage execution.
 *
 * The Agent Loop queries the registry to:
 * - Get available tool schemas (sent to the LLM)
 * - Check concurrency safety for parallel scheduling
 * - Execute tools through the prepare → dispatch → finalize pipeline
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool */
  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool "${tool.id}" already registered`);
    }
    this.tools.set(tool.id, tool);
  }

  /** Get a tool by id */
  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /** Get all registered tools */
  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  /** Get tool schemas in LLM-compatible format */
  getSchemas(): ToolSchema[] {
    return this.getAll().map((tool) => ({
      name: tool.id,
      description: tool.description,
      // Prefer raw JSON Schema (e.g. from MCP server) over Zod conversion
      inputSchema: tool.rawJsonSchema ?? zodToJsonSchema(tool.inputSchema),
    }));
  }

  /**
   * Check if a tool is safe to run concurrently.
   * Used by the Agent Loop for parallel scheduling decisions.
   */
  isConcurrencySafe(name: string, args: unknown): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    return tool.isConcurrencySafe?.(args) ?? false;
  }

  // ── 3-Stage Execution Pipeline ──

  /**
   * Stage 1: Prepare — validate input and create execution context.
   *
   * This stage:
   * - Looks up the tool by name
   * - Validates input against the tool's Zod schema
   * - Creates the ToolContext
   * - Determines timeout
   *
   * Returns a PreparedExecution on success, or a ToolResult on validation failure.
   */
  prepare(
    name: string,
    input: unknown,
    context: ToolContext
  ): { ok: true; prepared: PreparedExecution } | { ok: false; result: ToolResult } {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        result: {
          success: false,
          error: `Unknown tool: "${name}"`,
          duration: 0,
        },
      };
    }

    // Validate input
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        result: {
          success: false,
          error: `Invalid input for tool "${name}": ${parsed.error.message}`,
          duration: 0,
        },
      };
    }

    return {
      ok: true,
      prepared: {
        tool,
        validatedInput: parsed.data,
        context,
        timeoutMs: tool.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
    };
  }

  /**
   * Stage 2: Dispatch — execute the tool with timeout control.
   *
   * This stage:
   * - Runs the tool's execute() method
   * - Enforces the timeout via AbortController
   * - Catches and normalizes errors
   */
  async dispatch(prepared: PreparedExecution): Promise<ToolResult> {
    const { tool, validatedInput, context, timeoutMs } = prepared;

    // Create a combined abort signal (tool timeout + external abort)
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      timeoutMs
    );

    // Listen for external abort
    const externalAbortHandler = () => timeoutController.abort();
    context.abortSignal.addEventListener("abort", externalAbortHandler, {
      once: true,
    });

    const start = Date.now();
    try {
      const result = await Promise.race([
        tool.execute(validatedInput, context),
        new Promise<ToolResult>((_, reject) => {
          timeoutController.signal.addEventListener("abort", () => {
            if (context.abortSignal.aborted) {
              reject(new Error("Tool execution cancelled"));
            } else {
              reject(
                new Error(
                  `Tool "${tool.id}" timed out after ${timeoutMs}ms`
                )
              );
            }
          });
        }),
      ]);

      return {
        ...result,
        duration: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        aborted: context.abortSignal.aborted,
        abortReason: context.abortSignal.aborted ? extractAbortReason(context.abortSignal) : undefined,
        duration: Date.now() - start,
      };
    } finally {
      clearTimeout(timeoutId);
      context.abortSignal.removeEventListener(
        "abort",
        externalAbortHandler
      );
    }
  }

  /**
   * Stage 3: Finalize — format result (post-processing hook).
   *
   * Currently a pass-through, but provides a seam for:
   * - Result truncation (for large outputs)
   * - Metadata enrichment
   * - Format normalization
   */
  finalize(result: ToolResult): ToolResult {
    // Truncate large data payloads for LLM context window
    if (result.data !== undefined) {
      const serialized = JSON.stringify(result.data);
      if (serialized.length > 50_000) {
        return {
          ...result,
          data: {
            _truncated: true,
            originalSize: serialized.length,
            preview: serialized.slice(0, 50_000),
          },
        };
      }
    }
    return result;
  }

  /**
   * Full pipeline: prepare → dispatch → finalize.
   *
   * This is the high-level API used by the Agent Loop for simple execution.
   * For more control (e.g., waterfall interception), use the individual stages.
   */
  async execute(
    name: string,
    input: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    // Stage 1: Prepare
    const prepResult = this.prepare(name, input, context);
    if (!prepResult.ok) return prepResult.result;

    // Stage 2: Dispatch
    const result = await this.dispatch(prepResult.prepared);

    // Stage 3: Finalize
    return this.finalize(result);
  }

  /** Check if a tool is registered */
  has(id: string): boolean {
    return this.tools.has(id);
  }

  get size(): number {
    return this.tools.size;
  }
}

/** Convert a Zod schema to JSON Schema (simplified) */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  // Simplified conversion — handles the common cases
  const z = schema as {
    _def?: {
      typeName?: string;
      shape?: () => Record<string, unknown>;
      items?: unknown;
      values?: unknown[];
      description?: string;
    };
    description?: string;
  };

  const typeName = z._def?.typeName;

  switch (typeName) {
    case "ZodObject": {
      const shape = z._def?.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        // If not optional, it's required
        const v = value as { isOptional?: () => boolean };
        if (!v.isOptional?.()) required.push(key);
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        ...(z.description ? { description: z.description } : {}),
      };
    }
    case "ZodString":
      return {
        type: "string",
        ...(z.description ? { description: z.description } : {}),
      };
    case "ZodNumber":
      return {
        type: "number",
        ...(z.description ? { description: z.description } : {}),
      };
    case "ZodBoolean":
      return {
        type: "boolean",
        ...(z.description ? { description: z.description } : {}),
      };
    case "ZodEnum": {
      const values = z._def?.values as string[] | undefined;
      return {
        type: "string",
        enum: values,
        ...(z.description ? { description: z.description } : {}),
      };
    }
    case "ZodArray":
      return {
        type: "array",
        items: z._def?.items
          ? zodToJsonSchema(z._def.items)
          : {},
      };
    case "ZodOptional":
      return z._def?.items
        ? zodToJsonSchema(z._def.items)
        : { type: "string" };
    default:
      return { type: "string" };
  }
}
