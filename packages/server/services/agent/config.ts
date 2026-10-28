// AGENT_MAX_ITERATIONS caps model turns per agent attempt; going over it escalates.
import { z } from 'zod';

const parsed = z.coerce
   .number()
   .int()
   .positive()
   .default(6)
   .safeParse(process.env.AGENT_MAX_ITERATIONS || undefined);

if (!parsed.success) {
   throw new Error(
      `Invalid AGENT_MAX_ITERATIONS: ${z.prettifyError(parsed.error)}`
   );
}

export const AGENT_MAX_ITERATIONS = parsed.data;

export function describeAgentConfig(): string {
   return `tool calling, max ${AGENT_MAX_ITERATIONS} iterations per attempt`;
}
