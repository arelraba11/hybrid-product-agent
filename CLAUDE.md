# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

Personal project that runs **locally only** (MacBook Pro M4 Pro, 24GB unified memory → budget ~14–16GB for local models). No deployment, no CI.
Originally a course final project; now being upgraded in phases (see Roadmap).

Hybrid design: **Ollama (local) + OpenAI API**. Each LLM component gets its provider and model from config.

## Architecture principles (apply to all new code)

- **Per-component provider config.** Planner, planner fallback, general chat, RAG answer, reviews (analysis + summaries), synthesis and math each read `<COMPONENT>_PROVIDER` + `<COMPONENT>_MODEL` from env. Never hardcode a model or provider inside a service.
- **Provider-agnostic LLM interface.** Provider-specific code lives only in `packages/server/llm/`.
- **Default split:** planner + general chat → Ollama; planner fallback + RAG answer + reviews + synthesis + math → OpenAI. Reason: planner failures are detectable (validation), generation failures are not.
- **Escalation (target, phase 4):** local first for planner/chat; escalate to OpenAI at most once per request, only on a detectable failure (zod validation error, unknown tool, timeout, empty/broken output). Log every escalation with its reason.
- **Embeddings are always local.** Changing the embedding model requires a full reindex.
- **No hardcoded domain data** (prices, FX rates, templated answers) in new code. Facts come from tools or RAG.
- **zod schemas are the single source of truth** for tool parameters and structured outputs.

## Roadmap

Change one thing per phase so eval deltas are attributable. Do not do work from a later phase unless explicitly asked.

1. **Infra + model upgrade** (code done; Ollama-backed verification pending): python-service removed (embeddings via Ollama `embeddinggemma`, vectors in SQLite with brute-force cosine in TS — no sqlite-vec), Prisma MySQL → SQLite, per-component provider config, models → `gemma4:12b` / `gpt-5.4-mini`, Responses API structured output. **Still to verify** (`./scripts/smoke.sh`): planner + chat on `gemma4:12b`, the 5 README scenarios on the default config, and the `phi3` legacy config.
2. **Eval harness** (done; openai-only baseline in `evals/BASELINE.md`): richer KB + 3 new products, router trace, golden set (`evals/cases.json`), `bun run eval`. **Still to run at home** (needs `gemma4:12b`/`phi3`): default + legacy baselines, appended to `evals/BASELINE.md`.
   - **2.6 Planner prompt fix:** add parameter names to `classifierPromptLocal` (prompt-only change). Run all three configs before and after.
3. **Remove hardcoded data:** prices in `policy.ts`, FX rates in `exchange.app.ts`, `buildDeterministicFinanceMessage`. Order of phases 3/4 to be decided after 2.6 results — phase 4 deletes `policy.ts` (and its hardcoded prices) anyway.
4. **Native tool calling + escalation:** replace the JSON planner, `policy.ts` and placeholders with schema-based tool calling. Math is also a candidate for local-first + escalation: its failure is detectable (the expression must pass the whitelist and evaluate).

**Next steps, in order:**

1. At home: `ollama pull gemma4:12b && ollama pull phi3`, run the default + legacy baselines with the current prompt (`bun run eval --config evals/configs/{default,legacy}.env --runs 3`), run `./scripts/smoke.sh`.
2. Step 2.6 (planner prompt fix).
3. Decide the order of phases 3/4.

## Working rules

- Start non-trivial tasks in plan mode; list the files you'll change and wait for approval.
- One commit per logical step.
- Before declaring a task done: server typechecks, client lint passes, and the 5 README demo scenarios still work (run them and show the output).
- No `any` in new code. Don't add a dependency without saying why.
- Never commit `.env`, DB files, `history.json`, or index/vector data.
- **Update this file** at the end of each phase (commands, env, architecture, roadmap marker).

## Known issues (remove each line when fixed)

- `router/policy.ts` (~460 lines of keyword heuristics + hardcoded prices) — deleted in phase 4. Don't extend it.
- `apps/exchange.app.ts` hardcoded rates; `buildDeterministicFinanceMessage` templated answers — phase 3.
- KB product filter is an exact match on the lowercased filename stem (`kbRepository.findByProduct`), so "BrewMaster Y" ≠ `brewmaster y coffee machine` and silently falls back to a global search.
- Primary planner prompt (`classifierPromptLocal`, used for `planner` whatever its provider/model) lists tool names but no parameter names; its only example is `{"userInput": ...}`. gpt-5.4-mini as primary copies `userInput` into every tool → `normalizeStep` nulls the params, and since the plan parses, the fallback (full prompt) never fires. Phase 4 candidate (schema-based tool calling).
- `sanitizeRoute` keyword checks are substring-based: `looksLikeExchangeQuestion` matches `ils` inside words like "emails" and injects a `getExchangeRate` step (eval `st-review`). Phase 4 (policy.ts is deleted).
- With null product names, `buildDeterministicFinanceMessage` can return a confidently wrong templated answer ("The total is 0 ILS.", eval `mt-total-tidal-aurora`) — phase 3.
- Planner still has no zod schema: the OpenAI fallback uses `json_object` (enforced), the local planner relies on the prompt + stop sequences — phase 4.

---

## Current state (phase 2 — update as phases land)

### Commands

Bun workspace (`packages/*`). Run from the repo root unless noted.

```bash
bun install                                        # JS deps for all workspaces
ollama serve                                       # must be running (planner, chat, embeddings)
ollama pull gemma4:12b && ollama pull embeddinggemma

bun run dev        # server (bun --watch) + client (vite) via concurrently (index.ts)
bun run index-kb   # (re)index data/products/*.txt into kb_chunks (scripts/index-kb.ts)
bun run format     # prettier --write .
./scripts/smoke.sh # 5 README scenarios + 1 chat prompt against a running `bun run dev` (needs jq)
bun run eval --config evals/configs/openai-only.env --runs 3   # golden set; also --filter <id|category|tag>, --verbose

cd packages/server && bun run typecheck            # tsc --noEmit
cd packages/server && bunx prisma migrate dev      # SQLite at prisma/chatbot.db; also runs prisma generate
cd packages/server && bunx prisma db seed          # prisma/seed.ts: KB product names + mixed reviews, idempotent
cd packages/server && bunx prisma generate         # client is imported from ./generated/prisma (not committed)

cd packages/client && bun run lint     # eslint (client only; server has no linter)
cd packages/client && bun run build    # tsc -b && vite build
```

There are no unit tests. The eval harness (`bun run eval`, see Evals below) is the regression check; it needs Ollama running (embeddings) and an OpenAI key.

### Environment

`packages/server/.env` (Bun auto-loads it; see `.env.example`): `OPENAI_API_KEY`, `DATABASE_URL` (`file:./chatbot.db`, relative to `prisma/`), `OLLAMA_URL` (default `http://127.0.0.1:11434`), `EMBEDDING_MODEL` (default `embeddinggemma`), `PRODUCT_DATA_DIR` (default `<repo>/data/products`), `PORT` (default 3000).

Per component (`PLANNER`, `PLANNER_FALLBACK`, `CHAT`, `RAG`, `REVIEWS`, `SYNTHESIS`, `MATH`, `JUDGE` — eval-only): `<C>_PROVIDER` (`ollama`|`openai`), `<C>_MODEL`, optional `<C>_MAX_TOKENS` (unset → no limit on Ollama, 1024 on OpenAI) and `<C>_REASONING_EFFORT` (OpenAI only; anything but `none` drops `temperature`, which gpt-5.x rejects then; gpt-4o-mini rejects `reasoning` entirely, so leave it unset for non-reasoning models). Defaults are in `llm/config.ts`; invalid values fail at startup. `OLLAMA_MODEL` and `PY_KB_URL` are no longer read.

The Vite dev server proxies `/api` to `http://localhost:3000` (`packages/client/vite.config.ts`).

### Architecture

React client → Express server on Bun (`packages/server`) → Ollama (local) + OpenAI. SQLite via Prisma holds products, reviews, summaries and KB chunks.

#### Chat request flow (`POST /api/chat`)

`controllers/chat.controller.ts` (zod: `prompt`, `conversationId` uuid) → `routerService.handleUserMessage` in `services/router.service.ts`, which:

1. **Plans** – `classify()`: `classifyWithPlanner` (component `planner`, `classifierPromptLocal`, stop sequences `PLANNER_STOP`) → on any error `classifyWithFallback` (component `plannerFallback`, `classifierPrompt`, `json_object`) → finally a single `generalChat` step. Plan shape: `{ plan: [{tool, parameters}], final_answer_synthesis_required }` (`services/router/types.ts`).
2. **Sanitizes** – `sanitizeRoute()` in `services/router/policy.ts` heavily rewrites the LLM plan with keyword heuristics: normalizes parameter aliases, injects/removes steps, and rebuilds the math step for budget/"total ILS" questions. It also contains hardcoded USD product prices (`knownUsdPriceForProduct`).
3. **Executes** steps sequentially in `executeSingleStep()`. Parameters can reference earlier outputs with `<result_from_tool_N>` (1-based), resolved by `services/router/placeholders.ts` — it substitutes the step's `numericValue` when present, otherwise its text output.
4. **Answers** – `buildDeterministicFinanceMessage()` (`services/router/postprocess.ts`) may short-circuit with a templated answer; otherwise the answer is synthesis (component `synthesis`, `ORCHESTRATION_SYNTHESIS_PROMPT`) when required, else the last step's output.
5. Appends both turns to the history store and saves it. Default is `historyRepository` (`packages/server/history.json`, gitignored); callers can inject any `HistoryStore` (`handleUserMessage(id, input, { history })`, e.g. `createInMemoryHistory()` in evals). Typing `/reset` clears all history.

`handleUserMessage` also returns a `RouterTrace` (`router/types.ts`; the controller ignores it): planner source (`primary`/`fallback`/`generalChat`) + errors, raw and sanitized plan, per-step resolved params/output/`numericValue`/`numericSource` (`hardcode` = `knownUsdPriceForProduct` supplied it)/latency/LLM calls, `answerSource` (`deterministic`/`synthesis`/`lastStep`), and token/cost totals. The trace is observability only — the `ExecutedStep[]` passed to synthesis is unchanged.

Adding a tool (until phase 4) means touching: `ToolName` in `router/types.ts`, `ALLOWED_TOOLS` + a `case` in `executeSingleStep` (router.service.ts), `normalizeStep` in `policy.ts`, and the classifier prompts.

#### Tools (`services/apps/`)

- `weather` – Open-Meteo geocoding + forecast (no key).
- `exchange` – static hardcoded rates to ILS (no API).
- `math` – evaluates an arithmetic-only expression via `Function` after a character whitelist; word problems are first turned into an expression by component `math`.
- `reviewAnalyzer` – `llm.generateObject('reviews', ReviewAnalysisSchema)` (provider-enforced JSON schema, then zod-parsed), with one self-correction pass when sentiment/score are inconsistent.
- `productInformation` – RAG: `searchKb` (product filter on lowercased `product_name`, global retry if empty) → `RAG_GENERATION_PROMPT` on component `rag`.
- `general` – keyword guardrails, then component `chat` with the last 20 history messages (no stop sequences).

#### LLM layer (`packages/server/llm/` — the only place with provider-specific code)

- `config.ts` – per-component config table + env parsing (zod); `describeLlmConfig()` is logged at startup.
- `index.ts` – `llm.generate(component, { prompt, temperature?, stop?, responseFormat? })` and `llm.generateObject(component, zodSchema, name, opts)`.
- `openai.provider.ts` – Responses API; structured output via `text.format` (`json_object`, or `json_schema` from `zodTextFormat`, strict). Errors surface; nothing is retried without the format.
- `ollama.provider.ts` – `/api/generate`, non-streaming; `num_predict` only if `<C>_MAX_TOKENS` is set; `format: 'json'` or `z.toJSONSchema(schema)`; stop sequences per call.
- `embeddings.ts` – Ollama `/api/embed`, always local; adds embeddinggemma task prefixes (`task: search result | query:` / `title: … | text:`).
- `usage.ts` – `collectLlmCalls(fn)`: AsyncLocalStorage collector (nestable). `llm.generate` and embeddings record every call (component, provider, model, latency, tokens from OpenAI `usage` / Ollama `prompt_eval_count`+`eval_count`, cost, error); no-op outside a collector. Prices: `OPENAI_PRICING` + `costFor()` in `config.ts` (USD/1M tokens; Ollama = 0; unknown model → `null`).

Prompts are template strings with `{{PLACEHOLDER}}` slots in `prompts/prompts.ts`; `.txt` prompts in `prompts/` are imported directly by Bun (e.g. `summarize-reviews.txt`).

#### Reviews feature (separate from the chat router)

`GET /api/products/:id/reviews` and `POST /api/products/:id/reviews/summarize` → `review.controller` → `review.service` (component `reviews`) → `review.repository` (Prisma/SQLite). Summaries are cached in the `summaries` table for 7 days (`prisma/schema.prisma`). `Product.price` is nullable and unused; product facts live in the KB. The client's `components/reviews/*` exist but are not mounted in `App.tsx`.

#### Knowledge base

Source docs are `data/products/*.txt`; `scripts/index-kb.ts` chunks them (220 words, 40 overlap), embeds with `EMBEDDING_MODEL`, and replaces all rows of `kb_chunks` (Prisma model `KbChunk`, embedding stored as Float32Array bytes, plus `embeddingModel`). Search (`services/kb/searchKb.ts`) goes through the `VectorIndex` interface in `services/kb/vectorSearch.ts`; the current `bruteForceIndex` loads the filtered rows and ranks by cosine in TS (fine at this size — swap the implementation for a real index later). `searchKb` warns once if the index is empty or was built with a different embedding model. Re-run `bun run index-kb` after editing product files or changing the embedding model. Each product doc keeps exactly one canonical FAQ price line (`- Price: N USD` / `- Base price:` / `- Promotional price:`) — the eval's derived scorer reads prices from it. The KB is the source of truth for prices.

#### Evals (`evals/`, runner in `packages/server/scripts/eval.ts` + `scripts/eval/`)

- `evals/cases.json` – golden set, validated by the zod schema in `scripts/eval/cases.ts`. `expect.tools` excludes `generalChat` (`[]` = no tools), `allow_extra` lists tolerated extra tools; `args` are case-insensitive substring facts per tool step; `answer_contains` (inner array = any-of) / `answer_not_contains` are normalized and number/word-boundary aware; `derived` computes the expected ILS number from the trace's `getExchangeRate` value and KB prices (so it survives phase 3); `judge.rubric` → component `judge` (`EVAL_JUDGE_PROMPT`). Tags: `readme`, `hardcode-sensitive`, `fx-static`, `new-product`, `filter-mismatch`.
- `evals/configs/{default,legacy,openai-only}.env` – must set every component; the runner clears component vars inherited from `packages/server/.env` and dynamically imports the server after applying the config. Judge is gpt-5.4-mini in all configs.
- Each case-run gets a fresh conversation id and in-memory history (never touches `history.json`). Raw results with full traces → `evals/results/` (gitignored); console prints per-case, category, tag and scorer pass rates plus latency p50/p95, tokens, router/judge cost, fallback, deterministic-answer and hardcoded-price rates.

## Conventions

Prettier config in `.prettierrc` (3-space indent). Several user-facing strings and keyword lists are in Hebrew.
