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

1. **Infra + model upgrade** (done; verified 2026-10-28): python-service removed (embeddings via Ollama `embeddinggemma`, vectors in SQLite with brute-force cosine in TS — no sqlite-vec), Prisma MySQL → SQLite, per-component provider config, models → `gemma4:12b` / `gpt-5.4-mini`, Responses API structured output. Planner + chat run on `gemma4:12b` (needs `PLANNER_THINK`/`CHAT_THINK=false`) and on `phi3` (legacy). All 5 README smoke scenarios work on the default config since step 2.6.
2. **Eval harness** (done 2026-10-28; openai-only, default and legacy baselines in `evals/BASELINE.md`): richer KB + 3 new products, router trace, golden set (`evals/cases.json`), `bun run eval`. Default 24/90, legacy 66/90, openai-only 30/90. Default needs `PLANNER_THINK=false` (gemma4 otherwise spends its whole token budget thinking → ~100% fallback).
   - **2.6 Planner prompt fix** (done, `006458d`): canonical parameter names + one example per tool (not from the golden set) + no-code-fences rule in `classifierPromptLocal`. openai-only 27 → 78/90, default 24 → 76/90, legacy 66 → 72/90 (`evals/BASELINE.md`, "Step 2.6").
3. **Remove hardcoded data** (done 2026-10-28; per-step rows in `evals/BASELINE.md`, "Phase 3"): 3.1 token/prefix KB product filter (`productMatch.ts`), 3.2 `knownUsdPriceForProduct` removed, 3.3 `buildDeterministicFinanceMessage` removed (synthesis answers), 3.4 live FX (Frankfurter, cached, never a hardcoded rate), 3.5 stale-`exchangeIndex` fix in `sanitizeRoute` (live rates exposed it: 3.4 dipped to 72/90 because synthesis did the arithmetic for a self-referencing math step). **Default 80 → 79/90 at `987913c`: the phase 4 reference.**
4. **Native tool calling + escalation** (← current phase): replace the JSON planner, `policy.ts` and placeholders with schema-based tool calling. Math is also a candidate for local-first + escalation: its failure is detectable (the expression must pass the whitelist and evaluate).

**Next steps, in order:**

1. Phase 4. Compare every step against the phase 3 end state (default 79/90 at `987913c`, "Phase 3" in `evals/BASELINE.md`).

## Working rules

- Start non-trivial tasks in plan mode; list the files you'll change and wait for approval.
- One commit per logical step.
- Before declaring a task done: server typechecks, client lint passes, and the 5 README demo scenarios still work (run them and show the output).
- No `any` in new code. Don't add a dependency without saying why.
- Never commit `.env`, DB files, `history.json`, or index/vector data.
- **Update this file** at the end of each phase (commands, env, architecture, roadmap marker).

## Known issues (remove each line when fixed)

- `router/policy.ts` (~440 lines of keyword heuristics; `detectKnownProducts` still lists product names) — deleted in phase 4. Don't extend it.
- `exchange.app.ts` `extractAmount` takes the first `N USD|EUR|GBP|ILS` in the user input as the amount to convert, so for "I have 500 ILS…" the tool output says "500 USD = … ILS" (a misleading line synthesis has to ignore). The rate itself is right. Phase 4 (amount becomes a tool parameter).
- `sanitizeRoute` keyword checks are substring-based: `looksLikeExchangeQuestion` matches `ils` inside words like "emails" and injects a `getExchangeRate` step (eval `st-review`). Phase 4 (policy.ts is deleted).
- `extractUsdAmount` (`router.service.ts`) falls back to `price[^0-9]*(\d+)` when the RAG output has no "USD": for "The price for **NeoBook Air 14** is **not available in the KB**." it returns `14` (from the product name), which placeholders then put into the math. The trigger in `mt-total-brewmaster-neobook` (a product-filter miss) is fixed in 3.1, but any RAG answer without "USD" still hits it. Phase 4 (placeholders replaced).
- Synthesis silently does arithmetic when a tool step fails: if `calculateMath` errors (bad expression, empty placeholder), `ORCHESTRATION_SYNTHESIS_PROMPT` lets the model compute the number itself and present it as fact. The static 3.75 rate made that look reliable (mental-math friendly); at live 4-digit rates it was wrong 9/9 runs (3.4, before the 3.5 fix). Synthesis must never compute numbers — it reports which step failed. Phase 4.
- `sanitizeRoute` rewrites correct "total in ILS" plans (2× product + math) into 5 steps with an extra `calculateMath` (eval `mt-total-*`, tools scorer) — phase 4.
- gemma4:12b emits broken JSON for math plans (unterminated object: a `}` missing after `expression`, both `st-math-*` cases, 3/3 runs) → detectable, the fallback planner handles it (default fallback 7%). Phase 4 (schema-based tool calling).
- phi3 code fences: `PLANNER_STOP` contains ` ``` `, and phi3 still starts its planner output with ` ```json ` on 5 of 30 cases despite the prompt's no-fences rule (8 before 2.6), so generation stops at the first token → empty plan → fallback (legacy fallback 16%). Same stop list as before phase 1, kept so legacy measures the old behavior; phase 4 (tool calling) removes the stop-sequence planner.
- Planner still has no zod schema: the OpenAI fallback uses `json_object` (enforced), the local planner relies on the prompt + stop sequences — phase 4.
- The agent loop (`AGENT=tools`) sees only the current input, not the conversation history (same as the legacy planner), so follow-ups like "and the drone?" don't resolve. History goes only to CHAT. Intentional for phase 4.

---

## Current state (phase 3 done; phase 4 current — update as phases land)

### Commands

Bun workspace (`packages/*`). Run from the repo root unless noted.

```bash
bun install                                        # JS deps for all workspaces
ollama serve                                       # must be running (planner, chat, embeddings)
ollama pull gemma4:12b && ollama pull embeddinggemma

bun run dev        # server (bun --watch) + client (vite) via concurrently (index.ts)
bun run index-kb   # (re)index data/products/*.txt into kb_chunks (scripts/index-kb.ts)
bun run format     # prettier --write .
bun test           # unit tests (bun:test): kb/productMatch, apps/exchange (mocked fetch + clock), agent/loop (mocked LLM), agent/tools, eval scorers
./scripts/smoke.sh # 5 README scenarios + 1 chat prompt against a running `bun run dev` (needs jq)
bun run eval --config evals/configs/openai-only.env --runs 3   # golden set; also --agent legacy|tools, --filter <id|category|tag>, --verbose
bun run eval --rescore evals/results/<file>.json               # re-score saved traces offline (no LLM calls; judge verdicts kept)

cd packages/server && bun run typecheck            # tsc --noEmit
cd packages/server && bunx prisma migrate dev      # SQLite at prisma/chatbot.db; also runs prisma generate
cd packages/server && bunx prisma db seed          # prisma/seed.ts: KB product names + mixed reviews, idempotent
cd packages/server && bunx prisma generate         # client is imported from ./generated/prisma (not committed)

cd packages/client && bun run lint     # eslint (client only; server has no linter)
cd packages/client && bun run build    # tsc -b && vite build
```

Unit tests are few (`bun test`, pure functions only). The eval harness (`bun run eval`, see Evals below) is the main regression check; it needs Ollama running (embeddings) and an OpenAI key.

### Environment

`packages/server/.env` (Bun auto-loads it; see `.env.example`): `OPENAI_API_KEY`, `DATABASE_URL` (`file:./chatbot.db`, relative to `prisma/`), `OLLAMA_URL` (default `http://127.0.0.1:11434`), `EMBEDDING_MODEL` (default `embeddinggemma`), `PRODUCT_DATA_DIR` (default `<repo>/data/products`), `PORT` (default 3000), `LLM_TIMEOUT_MS` (default 60000; per-call timeout for every LLM and embedding request, both providers — not a component var, so evals inherit it from `.env`), `FX_TIMEOUT_MS` (default 5000; Frankfurter request timeout, parsed in `exchange.app.ts`), `AGENT` (`legacy` default | `tools`; phase 4 switch, `services/agent/config.ts`; the eval runner sets it from `--agent`, never from `.env`), `AGENT_MAX_ITERATIONS` (default 6; model turns per agent attempt).

Per component (`PLANNER`, `PLANNER_FALLBACK`, `CHAT`, `RAG`, `REVIEWS`, `SYNTHESIS`, `MATH`, `JUDGE` — eval-only): `<C>_PROVIDER` (`ollama`|`openai`), `<C>_MODEL`, optional `<C>_MAX_TOKENS` (unset → no limit on Ollama, 1024 on OpenAI; `.env.example` and the default/legacy eval configs set `PLANNER_MAX_TOKENS=512`, `CHAT_MAX_TOKENS=1024` — leaving an Ollama component unlimited lets it run away), `<C>_THINK` (`true`|`false`, Ollama only; sent as `think` only when set — unset leaves the model default; models without the thinking capability such as phi3 reject `think: true`. gemma4 thinks by default: its thinking goes to Ollama's separate `thinking` field and eats `MAX_TOKENS`, which left the planner's `response` empty. `.env.example` and `default.env` set `PLANNER_THINK=false`, `CHAT_THINK=false`; legacy leaves it unset) and `<C>_REASONING_EFFORT` (OpenAI only; anything but `none` drops `temperature`, which gpt-5.x rejects then; gpt-4o-mini rejects `reasoning` entirely, so leave it unset for non-reasoning models). Defaults are in `llm/config.ts`; invalid values fail at startup. `OLLAMA_MODEL` and `PY_KB_URL` are no longer read.

The Vite dev server proxies `/api` to `http://localhost:3000` (`packages/client/vite.config.ts`).

### Architecture

React client → Express server on Bun (`packages/server`) → Ollama (local) + OpenAI. SQLite via Prisma holds products, reviews, summaries and KB chunks.

#### Chat request flow (`POST /api/chat`)

`controllers/chat.controller.ts` (zod: `prompt`, `conversationId` uuid) → `routerService.handleUserMessage` in `services/router.service.ts`, which:

1. **Plans** – `classify()`: `classifyWithPlanner` (component `planner`, `classifierPromptLocal`, stop sequences `PLANNER_STOP`) → on any error `classifyWithFallback` (component `plannerFallback`, `classifierPrompt`, `json_object`) → finally a single `generalChat` step. Plan shape: `{ plan: [{tool, parameters}], final_answer_synthesis_required }` (`services/router/types.ts`).
2. **Sanitizes** – `sanitizeRoute()` in `services/router/policy.ts` heavily rewrites the LLM plan with keyword heuristics: normalizes parameter aliases, injects/removes steps, and rebuilds the math step for budget/"total ILS" questions. Budget math references the product steps' `numericValue` via placeholders (no hardcoded prices since 3.2).
3. **Executes** steps sequentially in `executeSingleStep()`. Parameters can reference earlier outputs with `<result_from_tool_N>` (1-based), resolved by `services/router/placeholders.ts` — it substitutes the step's `numericValue` when present, otherwise its text output.
4. **Answers** – synthesis (component `synthesis`, `ORCHESTRATION_SYNTHESIS_PROMPT`) when `final_answer_synthesis_required` (`sanitizeRoute` forces it for >1 non-chat step), else the last step's output. No templated answers since 3.3.
5. Appends both turns to the history store and saves it. Default is `historyRepository` (`packages/server/history.json`, gitignored); callers can inject any `HistoryStore` (`handleUserMessage(id, input, { history })`, e.g. `createInMemoryHistory()` in evals). Typing `/reset` clears all history.

`handleUserMessage` also returns a `RouterTrace` (`router/types.ts`; the controller ignores it): planner source (`primary`/`fallback`/`generalChat`) + errors, raw and sanitized plan, per-step resolved params/output/`numericValue`/`numericSource` (`output` = parsed from the tool output)/latency/LLM calls, `answerSource` (`synthesis`/`lastStep`), and token/cost totals. The trace is observability only — the `ExecutedStep[]` passed to synthesis is unchanged.

Adding a tool (until phase 4) means touching: `ToolName` in `router/types.ts`, `ALLOWED_TOOLS` + a `case` in `executeSingleStep` (router.service.ts), `normalizeStep` in `policy.ts`, and the classifier prompts.

#### Tools (`services/apps/`)

- `weather` – Open-Meteo geocoding + forecast (no key).
- `exchange` – live ECB reference rates to ILS from Frankfurter (`api.frankfurter.dev/v1/latest?base=<CODE>&symbols=ILS`, no key, zod-validated). In-memory cache per currency: fresh for 1 h; if a refresh fails, a cached rate up to 24 h old is served and labeled "cached: live update unavailable"; otherwise the tool returns an error string (`numericValue` null). Never a hardcoded rate. Output keeps `rate N` first because `extractNumericValue` parses it. Unknown currency (404) → "I don't have a rate for X."
- `math` – evaluates an arithmetic-only expression via `Function` after a character whitelist; word problems are first turned into an expression by component `math`.
- `reviewAnalyzer` – `llm.generateObject('reviews', ReviewAnalysisSchema)` (provider-enforced JSON schema, then zod-parsed), with one self-correction pass when sentiment/score are inconsistent.
- `productInformation` – RAG: `searchKb` (product filter via `matchProductNames` in `services/kb/productMatch.ts`: stopwords `the`/`a`/`an` dropped, every query token a prefix of a stored-name token, or space-free prefix; global search if no name matches or the filter returns nothing) → `RAG_GENERATION_PROMPT` on component `rag`.
- `general` – keyword guardrails, then component `chat` with the last 20 history messages (no stop sequences).

#### LLM layer (`packages/server/llm/` — the only place with provider-specific code)

- `config.ts` – per-component config table + env parsing (zod); `describeLlmConfig()` is logged at startup.
- `index.ts` – `llm.generate(component, { prompt, temperature?, stop?, responseFormat? })` and `llm.generateObject(component, zodSchema, name, opts)`. Each call gets `AbortSignal.timeout(LLM_TIMEOUT_MS)`, passed to the provider (Ollama `fetch` signal — aborting stops generation server-side; OpenAI request `signal`, which the SDK doesn't retry, unlike its own `timeout`). A timeout throws `<component> (<provider>/<model>) timed out after Nms`, recorded in the trace like any failure; for the planner it triggers the normal fallback chain.
- `openai.provider.ts` – Responses API; structured output via `text.format` (`json_object`, or `json_schema` from `zodTextFormat`, strict). Errors surface; nothing is retried without the format.
- `ollama.provider.ts` – `/api/generate`, non-streaming; `num_predict` only if `<C>_MAX_TOKENS` is set; `think` only if `<C>_THINK` is set; a returned `thinking` trace is never used as the text, only its length is recorded (`thinkingChars` on the call; `eval_count` includes thinking tokens, Ollama gives no separate count); `format: 'json'` or `z.toJSONSchema(schema)`; stop sequences per call.
- `embeddings.ts` – Ollama `/api/embed`, always local, same `LLM_TIMEOUT_MS`; adds embeddinggemma task prefixes (`task: search result | query:` / `title: … | text:`).
- `usage.ts` – `collectLlmCalls(fn)`: AsyncLocalStorage collector (nestable). `llm.generate` and embeddings record every call (component, provider, model, latency, tokens from OpenAI `usage` / Ollama `prompt_eval_count`+`eval_count`, cost, error); no-op outside a collector. Prices: `OPENAI_PRICING` + `costFor()` in `config.ts` (USD/1M tokens; Ollama = 0; unknown model → `null`).

Prompts are template strings with `{{PLACEHOLDER}}` slots in `prompts/prompts.ts`; `.txt` prompts in `prompts/` are imported directly by Bun (e.g. `summarize-reviews.txt`).

#### Reviews feature (separate from the chat router)

`GET /api/products/:id/reviews` and `POST /api/products/:id/reviews/summarize` → `review.controller` → `review.service` (component `reviews`) → `review.repository` (Prisma/SQLite). Summaries are cached in the `summaries` table for 7 days (`prisma/schema.prisma`). `Product.price` is nullable and unused; product facts live in the KB. The client's `components/reviews/*` exist but are not mounted in `App.tsx`.

#### Knowledge base

Source docs are `data/products/*.txt`; `scripts/index-kb.ts` chunks them (220 words, 40 overlap), embeds with `EMBEDDING_MODEL`, and replaces all rows of `kb_chunks` (Prisma model `KbChunk`, embedding stored as Float32Array bytes, plus `embeddingModel`). Search (`services/kb/searchKb.ts`) goes through the `VectorIndex` interface in `services/kb/vectorSearch.ts`; the current `bruteForceIndex` loads the filtered rows and ranks by cosine in TS (fine at this size — swap the implementation for a real index later). `searchKb` warns once if the index is empty or was built with a different embedding model. Re-run `bun run index-kb` after editing product files or changing the embedding model. Each product doc keeps exactly one canonical FAQ price line (`- Price: N USD` / `- Base price:` / `- Promotional price:`) — the eval's derived scorer reads prices from it. The KB is the source of truth for prices.

#### Evals (`evals/`, runner in `packages/server/scripts/eval.ts` + `scripts/eval/`)

- `evals/cases.json` – golden set, validated by the zod schema in `scripts/eval/cases.ts`. `expect.tools` excludes `generalChat` (`[]` = no tools); the tools scorer requires each listed tool at least as often as listed (repeats fine), any other tool must be in `allow_extra`, and optional `ordered` (no case sets it) requires that order as a subsequence; `args` are case-insensitive substring facts per tool step; `answer_contains` (inner array = any-of) / `answer_not_contains` are normalized and number/word-boundary aware; `derived` computes the expected ILS number from the trace's `getExchangeRate` value (live since 3.4) and KB prices; tolerance max(1 ILS, 0.5% of expected) unless the case sets an absolute `tolerance`; `judge.rubric` → component `judge` (`EVAL_JUDGE_PROMPT`); `grounded_numbers` (informational: reported per case, never fails a run) checks that every number in a tool-backed answer appears in a tool output or the input (rounding allowed). Tags: `readme`, `hardcode-sensitive`, `fx-static`, `new-product`, `filter-mismatch`.
- `evals/configs/{default,legacy,openai-only}.env` – must set every component; the runner clears component vars inherited from `packages/server/.env` and dynamically imports the server after applying the config. Judge is gpt-5.4-mini in all configs.
- Each case-run gets a fresh conversation id and in-memory history (never touches `history.json`). Raw results with full traces → `evals/results/` (gitignored); console prints per-case, category, tag and scorer pass rates plus latency p50/p95, tokens, router/judge cost and fallback rate.

## Conventions

Prettier config in `.prettierrc` (3-space indent). Several user-facing strings and keyword lists are in Hebrew.
