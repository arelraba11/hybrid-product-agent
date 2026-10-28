// AGENT selects the router: 'legacy' (JSON planner + policy.ts) or 'tools' (native tool calling).
// AGENT_MAX_ITERATIONS caps model turns per attempt; going over it escalates.
import { z } from 'zod';

const parsed = z
   .object({
      AGENT: z.enum(['legacy', 'tools']).default('legacy'),
      AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(6),
   })
   .safeParse({
      AGENT: process.env.AGENT || undefined,
      AGENT_MAX_ITERATIONS: process.env.AGENT_MAX_ITERATIONS || undefined,
   });

if (!parsed.success) {
   throw new Error(`Invalid agent config: ${z.prettifyError(parsed.error)}`);
}

export const AGENT_MODE = parsed.data.AGENT;
export const AGENT_MAX_ITERATIONS = parsed.data.AGENT_MAX_ITERATIONS;

export function describeAgentConfig(): string {
   return AGENT_MODE === 'tools'
      ? `tools (max ${AGENT_MAX_ITERATIONS} iterations per attempt)`
      : 'legacy (JSON planner + policy.ts)';
}
