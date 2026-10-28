// packages/server/llm/openai.provider.ts
import OpenAI from 'openai';
import { zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod';
import type {
   FunctionTool,
   Response,
   ResponseCreateParamsNonStreaming,
   ResponseFormatTextConfig,
   ResponseInputItem,
} from 'openai/resources/responses/responses';
import type {
   ChatRequest,
   ComponentConfig,
   GenerateOptions,
   LlmMessage,
   LlmUsage,
   ProviderChatResult,
   ProviderResult,
   ResponseFormat,
   ToolSpec,
} from './types';

let client: OpenAI | null = null;

// Lazy so the server can start fully local without an OpenAI key.
function getClient() {
   client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
   return client;
}

// Responses API structured output lives under text.format (not response_format).
function toTextFormat(format: ResponseFormat): ResponseFormatTextConfig {
   switch (format.type) {
      case 'text':
         return { type: 'text' };
      case 'json_object':
         return { type: 'json_object' };
      case 'json_schema':
         return zodTextFormat(format.schema, format.name);
   }
}

// Model, token limit, reasoning effort and temperature, shared by generate and chat.
function baseParams(
   cfg: ComponentConfig,
   input: ResponseCreateParamsNonStreaming['input'],
   temperature: number | undefined
): ResponseCreateParamsNonStreaming {
   const params: ResponseCreateParamsNonStreaming = {
      model: cfg.model,
      input,
      max_output_tokens: cfg.maxTokens,
   };

   if (cfg.reasoningEffort) {
      params.reasoning = { effort: cfg.reasoningEffort };
   }

   // Reasoning models reject temperature unless effort is 'none' (or left at the model default).
   const reasoningActive =
      cfg.reasoningEffort !== undefined && cfg.reasoningEffort !== 'none';
   if (temperature !== undefined && !reasoningActive) {
      params.temperature = temperature;
   }
   return params;
}

// A signal rather than the SDK's `timeout` option: the SDK retries its own timeouts
// (2x by default) but never a caller abort.
function createResponse(
   params: ResponseCreateParamsNonStreaming,
   signal: AbortSignal
): Promise<Response> {
   return getClient().responses.create(params, { signal });
}

function usageOf(response: Response): LlmUsage | null {
   return response.usage
      ? {
           inputTokens: response.usage.input_tokens,
           outputTokens: response.usage.output_tokens,
        }
      : null;
}

export async function generateOpenAI(
   cfg: ComponentConfig,
   { prompt, temperature, responseFormat }: GenerateOptions,
   signal: AbortSignal
): Promise<ProviderResult> {
   const params = baseParams(cfg, prompt, temperature);
   if (responseFormat) {
      params.text = { format: toTextFormat(responseFormat) };
   }

   const response = await createResponse(params, signal);
   return { text: response.output_text, usage: usageOf(response) };
}

// Strict function tool from the zod schema. Copied into a plain FunctionTool: the helper's
// result also carries client-side parsing hooks that the request doesn't need.
export function toOpenAITool(spec: ToolSpec): FunctionTool {
   const tool = zodResponsesFunction({
      name: spec.name,
      description: spec.description,
      parameters: spec.schema,
   });
   return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
   };
}

function toInputItems(m: LlmMessage): ResponseInputItem[] {
   switch (m.role) {
      case 'system':
      case 'user':
         return [{ role: m.role, content: m.content }];
      case 'assistant':
         // Our own earlier output items, replayed verbatim (reasoning + function calls).
         if (m.providerItems) return m.providerItems as ResponseInputItem[];
         return [
            ...(m.content
               ? [{ role: 'assistant' as const, content: m.content }]
               : []),
            ...m.toolCalls.map(
               (c): ResponseInputItem => ({
                  type: 'function_call',
                  call_id: c.id,
                  name: c.name,
                  arguments: c.arguments,
               })
            ),
         ];
      case 'tool':
         return [
            {
               type: 'function_call_output',
               call_id: m.toolCallId,
               output: m.content,
            },
         ];
   }
}

export async function chatOpenAI(
   cfg: ComponentConfig,
   { messages, tools, temperature }: ChatRequest,
   signal: AbortSignal
): Promise<ProviderChatResult> {
   const params = baseParams(cfg, messages.flatMap(toInputItems), temperature);
   params.tools = tools.map(toOpenAITool);

   const response = await createResponse(params, signal);
   return {
      text: response.output_text,
      toolCalls: response.output.flatMap((item) =>
         item.type === 'function_call'
            ? [{ id: item.call_id, name: item.name, arguments: item.arguments }]
            : []
      ),
      truncated: response.status === 'incomplete',
      providerItems: response.output,
      usage: usageOf(response),
   };
}
