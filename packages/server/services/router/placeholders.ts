import type { ExecutedStep, ToolName } from './types';

function normalizeToolFromAlias(value: string): ToolName | null {
   const key = value.toLowerCase().replace(/[_\s]/g, '');
   if (key.includes('weather')) return 'getWeather';
   if (key.includes('exchange')) return 'getExchangeRate';
   if (key.includes('review')) return 'analyzeReview';
   if (key.includes('product')) return 'getProductInformation';
   if (key.includes('math') || key.includes('calc')) return 'calculateMath';
   if (key.includes('general') || key.includes('chat')) return 'generalChat';
   return null;
}

function toValueText(hit: ExecutedStep | undefined): string {
   if (!hit) return '';
   if (hit.numericValue != null) return String(hit.numericValue);
   return hit.output;
}

function resolvePlaceholdersInString(
   value: string,
   results: ExecutedStep[]
): string {
   let out = value;

   out = out.replace(/<result_from_tool_(\d+)>/gi, (_, n) => {
      const idx = Number(n) - 1;
      if (idx < 0 || idx >= results.length) return '';
      return toValueText(results[idx]);
   });

   out = out.replace(/<result_from_previous_(?:step|tool)>/gi, () =>
      toValueText(results[results.length - 1])
   );

   out = out.replace(/<result_from_([a-zA-Z_]+)_\d+>/g, (_, alias) => {
      const tool = normalizeToolFromAlias(String(alias));
      if (!tool) return '';
      const found = [...results].reverse().find((r) => r.tool === tool);
      return toValueText(found);
   });

   out = out.replace(/<result_from_([a-zA-Z_]+)>/g, (_, alias) => {
      const tool = normalizeToolFromAlias(String(alias));
      if (!tool) return '';
      const found = [...results].reverse().find((r) => r.tool === tool);
      return toValueText(found);
   });

   return out;
}

export function resolveParameters(
   params: Record<string, unknown>,
   results: ExecutedStep[]
): Record<string, unknown> {
   const resolved: Record<string, unknown> = {};

   for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
         resolved[key] = resolvePlaceholdersInString(value, results);
      } else {
         resolved[key] = value;
      }
   }

   return resolved;
}
