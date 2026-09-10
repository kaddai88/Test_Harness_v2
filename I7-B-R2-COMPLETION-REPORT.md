# I7-B-R2 Completion Report: Runtime Closure

## Summary
I7-B-R2 is **APPROVED / CLOSED**. All three runtime gates are verified through real AgentLoop integration tests.

## Gates Verified

### R2-1: Request co-origin ✓
- Real LLM request captures observation envelope from current observation
- Provenance is captured from the same occurrence
- Test: `loop-r2.conformance.test.ts` R2-1

### R2-2: Dispatch throw invalidates current ✓
- Dispatch exceptions converted to `dispatch_error` status
- Current invalidated via fail-closed principle
- Test: `loop-r2.conformance.test.ts` R2-2

### R2-3: Authoritative observation sources funnel through I4 ✓
- Only `browser_snapshot` installs new current observation
- Other tools (click, type, etc.) do not install current
- Test: `loop-r2.conformance.test.ts` R2-3, R2-4

## Fixes Applied

### 1. Result initialization
Changed `let result: {...}` to initialize with default `definitely_not_applied` status. This ensures pre-dispatch errors (plugin deny, prepare failure) preserve current instead of invalidating it.

### 2. Dispatch throw handling
Added try-catch around `toolRegistry.dispatch()` to convert exceptions to `dispatch_error` status. This implements the fail-closed principle: if dispatch throws, we cannot prove no-effect, so current must be invalidated.

### 3. Test fixture updates
Updated test fixtures to use explicit `definitely_not_applied:` error message format, matching the new classification logic.

## Test Results
- **TypeScript compilation**: ✓ PASS
- **Full regression**: 355/355 tests PASS
- **New I7-B-R2 tests**: 4/4 PASS

## Files Modified
- `packages/agent/th-agent/src/loop.ts`: Result initialization, dispatch throw handling
- `packages/agent/th-agent/src/execution-boundary.conformance.test.ts`: Test fixture update
- `packages/agent/th-agent/src/agentloop-integration.conformance.test.ts`: Test fixture update
- `packages/agent/th-agent/src/loop-r2.conformance.test.ts`: New runtime integration tests

## Next Steps
I7 (I7-A + I7-B + I7-B-R1 + I7-B-R2) is now fully complete and closed. Ready to proceed to I8.
