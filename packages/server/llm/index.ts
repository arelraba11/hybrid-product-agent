// packages/server/llm/index.ts
// Provider-agnostic entry point. Services name a component; config picks provider + model.
import { llmConfig } from './config';
import { generateOllama } from './ollama.provider';
import { generateOpenAI } from './openai.provider';
import type { Component, GenerateOptions } from './types';

export const llm = {
   async generate(component: Component, opts: GenerateOptions): Promise<string> {
      const cfg = llmConfig[component];
      switch (cfg.provider) {
         case 'ollama':
            return generateOllama(cfg, opts);
         case 'openai':
            return generateOpenAI(cfg, opts);
      }
   },
};

export type { Component, GenerateOptions } from './types';
