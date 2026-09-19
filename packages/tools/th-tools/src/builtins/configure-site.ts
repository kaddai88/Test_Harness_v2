/** Built-in tool for explicitly scoped SiteProfile or session-local configuration. */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '@test-harness/th-protocol';
import type { THContainer } from '@test-harness/th-core';
import {
  SiteProfileCapabilityDefinition,
  type SiteProfileCapabilityRecord,
} from '@test-harness/th-browser';

const authSchema = z.object({
  usernameHint: z.string().optional(),
  passwordHint: z.string().optional(),
  submitHint: z.string().optional(),
  successIndicator: z.string().optional(),
  loginUrl: z.string().optional(),
});

const constraintsSchema = z.object({
  slowLoad: z.boolean().optional(),
  hasIframes: z.boolean().optional(),
  captcha: z.boolean().optional(),
  mfa: z.boolean().optional(),
  shadowDom: z.boolean().optional(),
  antiBot: z.boolean().optional(),
});

const inputSchema = z.object({
  scope: z.enum(['profile', 'session']).describe('Explicit mutation scope.'),
  action: z.enum(['set', 'get', 'clear']).optional(),
  name: z.string().min(1).optional(),
  auth: authSchema.optional(),
  constraints: constraintsSchema.optional(),
});

interface SessionConfiguration {
  name?: string;
  auth?: z.infer<typeof authSchema>;
  constraints?: z.infer<typeof constraintsSchema>;
}

function profileForDisplay(profile: SiteProfileCapabilityRecord): Record<string, unknown> {
  return {
    profileId: profile.id,
    canonicalOrigin: profile.canonicalOrigin,
    name: profile.name,
    cachedElements: profile.elementCache.length,
    testCount: profile.testCount,
    lastTestedAt: profile.lastTestedAt,
  };
}

export function createConfigureSiteTool(container: THContainer): Tool {
  const capability = container.get(SiteProfileCapabilityDefinition);
  let sessionConfiguration: SessionConfiguration = {};

  return {
    id: 'configure_site',
    name: 'Configure Site',
    description: 'Read or update explicitly scoped site configuration.',
    category: 'browser',
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 5_000,
    isConcurrencySafe: () => false,

    async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
      const start = Date.now();
      try {
        const parsed = inputSchema.parse(input);
        if (context.sessionId !== capability.binding.sessionId) {
          throw new TypeError('Tool session does not match the explicit SiteProfile capability binding');
        }
        const action = parsed.action ?? 'set';

        if (parsed.scope === 'session') {
          if (action === 'get') {
            return { success: true, data: { scope: 'session', sessionId: context.sessionId,
              configuration: structuredClone(sessionConfiguration) }, duration: Date.now() - start };
          }
          if (action === 'clear') sessionConfiguration = {};
          else sessionConfiguration = {
            ...sessionConfiguration,
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(parsed.auth !== undefined ? { auth: parsed.auth } : {}),
            ...(parsed.constraints !== undefined ? { constraints: parsed.constraints } : {}),
          };
          return { success: true, data: { scope: 'session', sessionId: context.sessionId,
            configuration: structuredClone(sessionConfiguration) }, duration: Date.now() - start };
        }

        if (parsed.auth !== undefined || parsed.constraints !== undefined) {
          throw new TypeError('auth and constraints are session-local and are not durable SiteProfile fields');
        }
        if (action === 'clear') {
          const profile = await capability.replaceLocatorCache([], `configure-site:${context.sessionId}:clear-cache`);
          return { success: true, data: { scope: 'profile', configuration: profileForDisplay(profile) },
            duration: Date.now() - start };
        }
        if (action === 'set' && parsed.name !== undefined) {
          const profile = await capability.updateName(parsed.name,
            `configure-site:${context.sessionId}:name:${encodeURIComponent(parsed.name)}`);
          return { success: true, data: { scope: 'profile', configuration: profileForDisplay(profile) },
            duration: Date.now() - start };
        }
        const profile = await capability.read();
        return { success: true, data: { scope: 'profile', configuration: profileForDisplay(profile) },
          duration: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start };
      }
    },
  };
}
