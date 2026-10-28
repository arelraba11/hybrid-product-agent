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

1. **Infra + model upgrade** (done; verified 2026-10-28): python-service removed (embeddings via Ollama `embeddinggemma`, vectors in SQLite with brute-force cosine in TS — no sqlite-vec), Prisma MySQL → SQLite, per-component provider config, models → `gemma4:12b` / `gpt-5.4-mini`, Responses API structured output. Planner + chat run on `gemma4:12b` (needs `PLANNER_THINK`/`CHAT_THINK=false`) and on `phi3` (legacy; retired in 4.3, no tool calling). All 5 README smoke scenarios work on the default config since step 2.6.
2. **Eval harness** (done 2026-10-28; openai-only, default and legacy baselines in `evals/BASELINE.md`): richer KB + 3 new products, router trace, golden set (`evals/cases.json`), `bun run eval`. Default 24/90, legacy 66/90, openai-only 30/90. Default needs `PLANNER_THINK=false` (gemma4 otherwise spends its whole token budget thinking → ~100% fallback).
   - **2.6 Planner prompt fix** (done, `006458d`): canonical parameter names + one example per tool (not from the golden set) + no-code-fences rule in `classifierPromptLocal`. openai-only 27 → 78/90, default 24 → 76/90, legacy 66 → 72/90 (`evals/BASELINE.md`, "Step 2.6").
3. **Remove hardcoded data** (done 2026-10-28; per-step rows in `evals/BASELINE.md`, "Phase 3"): 3.1 token/prefix KB product filter (`productMatch.ts`), 3.2 `knownUsdPriceForProduct` removed, 3.3 `buildDeterministicFinanceMessage` removed (synthesis answers), 3.4 live FX (Frankfurter, cached, never a hardcoded rate), 3.5 stale-`exchangeIndex` fix in `sanitizeRoute` (live rates exposed it: 3.4 dipped to 72/90 because synthesis did the arithmetic for a self-referencing math step). **Default 80 → 79/90 at `987913c`: the phase 4 reference.**
4. **Native tool calling + escalation** (done 2026-10-28; per-step rows in `evals/BASELINE.md`, "Phase 4"): the JSON planner, `policy.ts`, placeholders, stop sequences and the `MATH` component are gone.
   - 4.0 reference: legacy agent, default + openai-only 81/90.
   - 4.1 zod tool definitions + `llm.chat`.
   - 4.2 agent loop with one repair + one escalation (behind a flag): default 81, openai-only 84/90.
   - 4.2b tools scorer accepts repeated tools, plus `grounded_numbers` (measurement only). Re-scored: default 87, openai-only 90/90.
   - 4.3 legacy path deleted. `legacy.env` retired: phi3 has no tool-calling capability in Ollama.

**Next steps:** none scheduled. The next phase isn't defined yet; candidates are under Follow-ups.

**Follow-ups (not scheduled; do only when asked):**

- Stress run on a weaker local planner (e.g. `gemma4:e4b`) to exercise repair and escalation on real data. On gemma4:12b they never fired (0/180 runs in 4.2), so they are covered only by the mocked tests in `services/agent/loop.test.ts`.
- Skip synthesis for a single self-answering tool (RAG answers are already user-facing) to cut latency: every tool answer now pays a synthesis call (default p50 2.2s → 3.8s in 4.2).

## Working rules

- Start non-trivial tasks in plan mode; list the files you'll change and wait for approval.
- One commit per logical step.
- Before declaring a task done: server typechecks, client lint passes, and the 5 README demo scenarios still work (run them and show the output).
- No `any` in new code. Don't add a dependency without saying why.
- Never commit `.env`, DB files, `history.json`, or index/vector data.
- **Update this file** at the end of each phase (commands, env, architecture, roadmap marker).

## Known issues (remove each line when fixed)

- The agent loop sees only the current input, not the conversation history (as the old planner did), so follow-ups like "and the drone?" don't resolve. History goes only to CHAT. Intentional for phase 4.
- Synthesis can still state a number that no tool produced: 2/78 tool-backed runs on default in 4.2. In `mt-total-tidal-aurora` it computed an "LTE variant" total itself, despite `AGENT_SYNTHESIS_PROMPT`'s no-arithmetic rule. The eval scorer `grounded_numbers` measures this but doesn't fail runs.
- gemma4:12b sums both Aurora variants (GPS 249 + LTE 299) into a two-product total (`mt-total-tidal-aurora` 0/3 derived on default). openai-only gets it right.
- `getExchangeRate` rounds converted amounts to 2 decimals, and the model may reuse the rounded value in `calculateMath` (`100 - 78.15` instead of `100 - 78.1475`). The effect is under 0.005 ILS per unit converted. An amount of 1 returns the unrounded rate.
- The agent sometimes issues a dependent call in the same turn as the call it depends on: gpt-5.4-mini sent `calculateMath("100 - 0")` alongside `getExchangeRate` in `mt-budget-printforge`, 3/3 runs. It's wasted (the right math follows next turn) but harmless.

---

## Current state (phase 4 done — update as phases land)

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
bun run eval --config evals/configs/openai-only.env --runs 3   # golden set; also --filter <id|category|tag>, --verbose
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

`packages/server/.env` (Bun auto-loads it; see `.env.example`): `OPENAI_API_KEY`, `DATABASE_URL` (`file:./chatbot.db`, relative to `prisma/`), `OLLAMA_URL` (default `http://127.0.0.1:11434`), `EMBEDDING_MODEL` (default `embeddinggemma`), `PRODUCT_DATA_DIR` (default `<repo>/data/products`), `PORT` (default 3000), `LLM_TIMEOUT_MS` (default 60000; per-call timeout for every LLM and embedding request, both providers — not a component var, so evals inherit it from `.env`), `FX_TIMEOUT_MS` (default 5000; Frankfurter request timeout, parsed in `exchange.app.ts`), `AGENT_MAX_ITERATIONS` (default 6; model turns per agent attempt before escalating, `services/agent/config.ts`).

Per component (`PLANNER`, `PLANNER_FALLBACK`, `CHAT`, `RAG`, `REVIEWS`, `SYNTHESIS`, `JUDGE` — eval-only; `MATH` was removed in 4.3, a leftover `MATH_*` var is ignored): `<C>_PROVIDER` (`ollama`|`openai`), `<C>_MODEL`, optional `<C>_MAX_TOKENS` (unset → no limit on Ollama, 1024 on OpenAI; `.env.example` and the default eval config set `PLANNER_MAX_TOKENS=512`, `CHAT_MAX_TOKENS=1024` — leaving an Ollama component unlimited lets it run away), `<C>_THINK` (`true`|`false`, Ollama only; sent as `think` only when set — unset leaves the model default; models without the thinking capability such as phi3 reject `think: true`. gemma4 thinks by default: its thinking goes to Ollama's separate `thinking` field and eats `MAX_TOKENS`, which left the planner's `response` empty. `.env.example` and `default.env` set `PLANNER_THINK=false`, `CHAT_THINK=false`) and `<C>_REASONING_EFFORT` (OpenAI only; anything but `none` drops `temperature`, which gpt-5.x rejects then; gpt-4o-mini rejects `reasoning` entirely, so leave it unset for non-reasoning models). Defaults are in `llm/config.ts`; invalid values fail at startup. `PLANNER_MODEL` on Ollama must have the `tools` capability (`ollama show <model>`; phi3 doesn't). `OLLAMA_MODEL` and `PY_KB_URL` are no longer read.

The Vite dev server proxies `/api` to `http://localhost:3000` (`packages/client/vite.config.ts`).

### Architecture

React client → Express server on Bun (`packages/server`) → Ollama (local) + OpenAI. SQLite via Prisma holds products, reviews, summaries and KB chunks.

#### Chat request flow (`POST /api/chat`)

`controllers/chat.controller.ts` (zod: `prompt`, `conversationId` uuid) → `routerService.handleUserMessage` (`services/router.service.ts`: `/reset`, trace totals, history) → `handleWithAgent` in `services/agent/handle.ts`:

1. **Agent loop** – `runAgent` in `services/agent/loop.ts`. Messages are `AGENT_SYSTEM_PROMPT` plus the current user input only (no history). The model gets the tools of `services/agent/tools.ts` and calls them until it stops calling tools; it only selects and runs tools, and its own final text is discarded.
   - Each call is checked (known tool → `JSON.parse` → zod `safeParse`). Valid calls of one turn run in parallel, and every call gets a tool message (invalid ones get the error).
   - **Repair:** the first invalid turn of an attempt (a zod error, unknown tool, unparseable args, or a tool call written as text per `looksLikeTextToolCall`) sends its errors back to the model once.
   - **Escalation:** the attempt fails on a second invalid turn, a provider error or timeout, truncated output, empty output on turn 1, or more than `AGENT_MAX_ITERATIONS` turns. The loop then restarts once from scratch on `plannerFallback`; every escalation is logged (`[agent] escalating…`).
2. **Answer** – if any tool ran, or both attempts failed, synthesis writes it (component `synthesis`, `AGENT_SYNTHESIS_PROMPT`, steps as `{step, tool, arguments, ok, output}` plus the failure reason). The prompt forbids arithmetic: every number must come from a tool output, and failed steps are named. If no tool was needed, `generalChat` (component `chat`) answers with the history. A failed agent never goes to chat, since chat could invent facts.
3. Appends both turns to the history store and saves it. Default is `historyRepository` (`packages/server/history.json`, gitignored); callers can inject any `HistoryStore` (`handleUserMessage(id, input, { history })`, e.g. `createInMemoryHistory()` in evals). Typing `/reset` clears all history.

`handleUserMessage` also returns a `RouterTrace` (`router/types.ts`; the controller ignores it):

- `plannerSource`: `primary`, `fallback` (escalated) or `failed`, plus errors
- `agent`:
   - attempts: component/provider/model, iterations with tool calls (name, raw arguments, validation error), text length, `textToolCall`, `truncated`, latency
   - repairs and escalation, each with a reason
   - outcome
- `steps` (the last attempt's executed calls): params, `ok`, output, `numericValue` (the rate or math result, returned by the tool), latency, LLM calls
- `answerSource` (`synthesis`/`chat`) and token/cost totals

The trace is observability only.

**Adding a tool:** add a `defineTool({ name, description, schema, execute })` entry to `TOOLS` in `services/agent/tools.ts` and the name to `ToolName` in `router/types.ts` (the eval's case schema derives from it). The zod schema (with `.describe()` on fields) is what both providers see. Mention the tool in `AGENT_SYSTEM_PROMPT` only if it needs a usage rule.

#### Tools (`services/agent/tools.ts` → `services/apps/`)

Each tool returns `{ ok, output, numericValue }`. `ok: false` means the tool ran but couldn't produce the fact, and synthesis reports it as failed. A throw becomes `ok: false`.

- `getWeather(city)` – Open-Meteo geocoding + forecast (no key); `ok: false` for an unknown city or an API error.
- `getExchangeRate(currencyCode, amount|null)` – live ECB reference rates to ILS from Frankfurter (`api.frankfurter.dev/v1/latest?base=<CODE>&symbols=ILS`, no key, zod-validated), via `exchangeToIls`.
   - In-memory cache per currency: fresh for 1 h. If a refresh fails, a cached rate up to 24 h old is served and labeled "cached: live update unavailable"; otherwise `ok: false` and `numericValue` null. Never a hardcoded rate.
   - `numericValue` is the rate. `amount` (a strict-schema nullable, defaulting to null when omitted) is converted and rounded to 2 decimals; an amount of 1 returns the unrounded rate.
   - Unknown currency (404) → "I don't have a rate for X."
- `calculateMath(expression)` – arithmetic only (`evaluateExpression`: character whitelist, then `Function`, must be finite). The check is part of the zod schema, so a bad expression is a validation error (repair/escalation), not a tool failure. `numericValue` is the result. There is no word-problem path: the model writes the expression.
- `analyzeReview(reviewText)` – `llm.generateObject('reviews', ReviewAnalysisSchema)` (provider-enforced JSON schema, then zod-parsed), with one self-correction pass when sentiment/score are inconsistent; formatted by `formatReviewAnalysis`.
- `getProductInformation(product_name, query)` – RAG (`productInformation`). `searchKb` filters by product via `matchProductNames` in `services/kb/productMatch.ts`: stopwords `the`/`a`/`an` dropped, every query token a prefix of a stored-name token, or a space-free prefix; global search if no name matches or the filter returns nothing. Then `RAG_GENERATION_PROMPT` on component `rag`. "Not in the KB" is `ok: true`; only a retrieval/generation error is `ok: false`.
- Not a tool: `apps/general.app.ts` – keyword guardrails, then component `chat` with the last 20 history messages.

#### LLM layer (`packages/server/llm/` — the only place with provider-specific code)

- `config.ts` – per-component config table + env parsing (zod); `describeLlmConfig()` is logged at startup.
- `index.ts` – `llm.generate(component, { prompt, temperature?, responseFormat? })`, `llm.generateObject(component, zodSchema, name, opts)` and `llm.chat(component, { messages, tools, temperature? })` (one tool-calling turn: provider-neutral `LlmMessage`s in, `{ text, toolCalls: [{id, name, arguments (raw JSON text)}], truncated, providerItems? }` out; arguments are not validated here). Each call gets `AbortSignal.timeout(LLM_TIMEOUT_MS)`, passed to the provider (Ollama `fetch` signal — aborting stops generation server-side; OpenAI request `signal`, which the SDK doesn't retry, unlike its own `timeout`). A timeout throws `<component> (<provider>/<model>) timed out after Nms`, recorded in the trace like any failure; for the planner it fails the agent attempt (→ escalation).
- `openai.provider.ts` – Responses API; structured output via `text.format` (`json_object`, or `json_schema` from `zodTextFormat`, strict). Errors surface; nothing is retried without the format. Tools: strict function tools from `zodResponsesFunction` (optional fields must be `.nullable()`); `function_call` output items become tool calls, and the raw output items are returned as `providerItems` and replayed verbatim next turn (keeps reasoning items with their calls); `truncated` = `status: 'incomplete'`.
- `ollama.provider.ts` – `/api/generate`, non-streaming; `num_predict` only if `<C>_MAX_TOKENS` is set; `think` only if `<C>_THINK` is set; a returned `thinking` trace is never used as the text, only its length is recorded (`thinkingChars` on the call; `eval_count` includes thinking tokens, Ollama gives no separate count); `format: 'json'` or `z.toJSONSchema(schema)`. Tools: `/api/chat` with `tools` from `z.toJSONSchema`; argument objects are stringified, missing call ids synthesized; `truncated` = `done_reason: 'length'`; tool results go back as `{role: 'tool', tool_name}`.
- `embeddings.ts` – Ollama `/api/embed`, always local, same `LLM_TIMEOUT_MS`; adds embeddinggemma task prefixes (`task: search result | query:` / `title: … | text:`).
- `usage.ts` – `collectLlmCalls(fn)`: AsyncLocalStorage collector (nestable). `llm.generate`, `llm.chat` and embeddings record every call (component, provider, model, latency, tokens from OpenAI `usage` / Ollama `prompt_eval_count`+`eval_count`, cost, error); no-op outside a collector. Prices: `OPENAI_PRICING` + `costFor()` in `config.ts` (USD/1M tokens; Ollama = 0; unknown model → `null`).

Prompts are template strings with `{{PLACEHOLDER}}` slots in `prompts/prompts.ts`; `.txt` prompts in `prompts/` are imported directly by Bun (e.g. `summarize-reviews.txt`).

#### Reviews feature (separate from the chat router)

`GET /api/products/:id/reviews` and `POST /api/products/:id/reviews/summarize` → `review.controller` → `review.service` (component `reviews`) → `review.repository` (Prisma/SQLite). Summaries are cached in the `summaries` table for 7 days (`prisma/schema.prisma`). `Product.price` is nullable and unused; product facts live in the KB. The client's `components/reviews/*` exist but are not mounted in `App.tsx`.

#### Knowledge base

Source docs are `data/products/*.txt`; `scripts/index-kb.ts` chunks them (220 words, 40 overlap), embeds with `EMBEDDING_MODEL`, and replaces all rows of `kb_chunks` (Prisma model `KbChunk`, embedding stored as Float32Array bytes, plus `embeddingModel`). Search (`services/kb/searchKb.ts`) goes through the `VectorIndex` interface in `services/kb/vectorSearch.ts`; the current `bruteForceIndex` loads the filtered rows and ranks by cosine in TS (fine at this size — swap the implementation for a real index later). `searchKb` warns once if the index is empty or was built with a different embedding model. Re-run `bun run index-kb` after editing product files or changing the embedding model. Each product doc keeps exactly one canonical FAQ price line (`- Price: N USD` / `- Base price:` / `- Promotional price:`) — the eval's derived scorer reads prices from it. The KB is the source of truth for prices.

#### Evals (`evals/`, runner in `packages/server/scripts/eval.ts` + `scripts/eval/`)

- `evals/cases.json` – golden set, validated by the zod schema in `scripts/eval/cases.ts`. `expect.tools` lists tools (`[]` = no tools); the tools scorer requires each listed tool at least as often as listed (repeats fine), any other tool must be in `allow_extra`, and optional `ordered` (no case sets it) requires that order as a subsequence; `args` are case-insensitive substring facts per tool step; `answer_contains` (inner array = any-of) / `answer_not_contains` are normalized and number/word-boundary aware; `derived` computes the expected ILS number from the trace's `getExchangeRate` value (live since 3.4) and KB prices; tolerance max(1 ILS, 0.5% of expected) unless the case sets an absolute `tolerance`; `judge.rubric` → component `judge` (`EVAL_JUDGE_PROMPT`); `grounded_numbers` (informational: reported per case, never fails a run) checks that every number in a tool-backed answer appears in a tool output or the input (rounding allowed). Tags: `readme`, `hardcode-sensitive`, `fx-static`, `new-product`, `filter-mismatch`.
- `evals/configs/{default,openai-only}.env` – must set every component (`legacy.env`, phi3/gpt-4o-mini, was retired in 4.3: phi3 can't call tools); the runner clears component vars inherited from `packages/server/.env` and dynamically imports the server after applying the config. Judge is gpt-5.4-mini in all configs.
- Each case-run gets a fresh conversation id and in-memory history (never touches `history.json`). Raw results with full traces → `evals/results/` (gitignored); console prints per-case, category, tag and scorer pass rates plus latency p50/p95, tokens, router/judge cost, fallback (= escalation) rate and agent metrics (repair/escalation rate + reasons, mean iterations, invalid-call rate, tool-call-as-text rate, chat answers). `--rescore <file>` re-scores saved traces offline; results files from before 4.3 (legacy trace, no `agent`) still rescore, but `generalChat` steps in them now count as unexpected tools.

## Conventions

Prettier config in `.prettierrc` (3-space indent). Several user-facing strings and keyword lists are in Hebrew.
