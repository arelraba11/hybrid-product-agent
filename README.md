# Hybrid Product Information Agent (Final Project)

This repository extends the previous `smart-bot` assignments into a hybrid agent with:

- Local + cloud model routing
- Advanced tool orchestration (multi-step plan execution)
- Product knowledge base retrieval (RAG) with local embeddings
- Per-component model config (Ollama local + OpenAI)

## Architecture Summary

- `packages/server` (TypeScript + Bun)
   - Router planner (local planner first, OpenAI fallback planner)
   - Sequential tool orchestration with placeholder support (`<result_from_tool_X>`)
   - Final answer synthesis when required
   - RAG retrieval in TS: Ollama `embeddinggemma` embeddings, vectors stored in SQLite
   - SQLite (Prisma) for products, reviews, the 7-day summary cache and KB chunks
- `data/products`
   - Product KB text files used for indexing and retrieval
- `packages/client`
   - Existing frontend chat UI

### Models per component

Every LLM component reads `<COMPONENT>_PROVIDER` and `<COMPONENT>_MODEL` from env (see `packages/server/.env.example`).

| Component                   | Env prefix          | Default                   |
| --------------------------- | ------------------- | ------------------------- |
| Router planner              | `PLANNER_`          | `ollama` / `gemma4:12b`   |
| Planner fallback            | `PLANNER_FALLBACK_` | `openai` / `gpt-5.4-mini` |
| General chat                | `CHAT_`             | `ollama` / `gemma4:12b`   |
| RAG answer                  | `RAG_`              | `openai` / `gpt-5.4-mini` |
| Review analysis + summaries | `REVIEWS_`          | `openai` / `gpt-5.4-mini` |
| Final synthesis             | `SYNTHESIS_`        | `openai` / `gpt-5.4-mini` |
| Math word problems          | `MATH_`             | `openai` / `gpt-5.4-mini` |
| Embeddings (always local)   | `EMBEDDING_MODEL`   | `embeddinggemma`          |

The previous models (`phi3:latest`, `gpt-4o-mini`) still work by setting the `*_MODEL` vars.

## New Core Capabilities

### 1) Router as Tool Orchestrator

Router now returns a plan object:

```json
{
   "plan": [
      { "tool": "getExchangeRate", "parameters": { "currencyCode": "USD" } },
      {
         "tool": "calculateMath",
         "parameters": { "expression": "100 - (25 * <result_from_tool_1>)" }
      }
   ],
   "final_answer_synthesis_required": true
}
```

Execution behavior:

- Parse and validate plan
- Execute tools step-by-step
- Resolve placeholders from previous tool outputs
- Keep intermediate state
- If `final_answer_synthesis_required=true`, run synthesis prompt with all intermediate results

### 2) Product RAG

`getProductInformation(product_name, query)` flow:

- Embeds the query locally (Ollama `embeddinggemma`)
- Gets the top-k chunks for that product (cosine similarity); retries over all products if the filter finds nothing
- Builds RAG prompt with user question + retrieved chunks
- Uses the `RAG_` model to produce a grounded final answer

### 3) Knowledge Base Indexing

`bun run index-kb` (`packages/server/scripts/index-kb.ts`):

- Loads `.txt` files from `data/products`
- Chunks text (220 words, 40 overlap) with `product_name` metadata from the file name
- Embeds chunks with `embeddinggemma`
- Stores vectors + metadata in the `kb_chunks` SQLite table

## Project Structure (relevant files)

- `packages/server/services/router.service.ts` - orchestration planner + executor
- `packages/server/services/apps/productInformation.app.ts` - RAG app integration
- `packages/server/services/kb/` - KB search (`searchKb`) behind a `VectorIndex` interface
- `packages/server/scripts/index-kb.ts` - KB indexing script
- `packages/server/llm/` - provider config + Ollama/OpenAI providers + embeddings
- `packages/server/prompts/prompts.ts` - router / RAG / synthesis prompts
- `packages/server/prisma/` - SQLite schema, migrations, dev seed
- `data/products/*.txt` - KB source files

## Setup

### 1) Install JS dependencies

```bash
bun install
```

### 2) Pull local models

```bash
ollama serve                 # keep running in its own terminal
ollama pull gemma4:12b       # planner + general chat (~8 GB)
ollama pull embeddinggemma   # embeddings (~620 MB)
```

### 3) Configure environment

```bash
cp packages/server/.env.example packages/server/.env   # then set OPENAI_API_KEY
```

### 4) Create the database and index the knowledge base

```bash
cd packages/server
bunx prisma migrate dev      # creates prisma/chatbot.db and generates the client
bunx prisma db seed          # sample products + reviews (no prices/specs; the KB holds facts)
cd ../..
bun run index-kb             # re-run after editing data/products/*.txt or changing EMBEDDING_MODEL
```

### 5) Start

```bash
bun run dev                  # server (packages/server) + client (packages/client)
```

## Required Demo Scenarios

### Orchestration Scenario 1

Input: `What is the weather in Paris and what is the USD exchange rate today?`

Expected plan:

- `getWeather`
- `getExchangeRate`
- synthesis

### Orchestration Scenario 2

Input: `Analyze this review on EvoPhone X: 'The phone is great but battery is weak', then tell me the average battery life from the KB.`

Expected plan:

- `analyzeReview`
- `getProductInformation`
- synthesis

### Orchestration Scenario 3

Input: `If Yossi has 100 ILS and wants to buy PrintForge 3D Printer costing 25 USD, how many ILS remain?`

Expected plan:

- `getExchangeRate`
- `getProductInformation`
- `calculateMath`
- synthesis

### RAG Scenario A

Input: `How much RAM does EvoPhone X have?`

Expected: KB-grounded answer (12GB)

### RAG Scenario B

Input: `What is the average battery life of EvoPhone X?`

Expected: KB-grounded answer (~9 hours active usage)

## Benchmarking Table (Expanded)

Historical: measured on the original course implementation (phi3 / gpt-4o-mini / Python service), before phase 1. New baselines per model config come with the phase 2 eval harness.

| System Component / Scenario                 | Model (Provider)                          | Avg Response Time (ms) | Quality / Accuracy (1-5) | Estimated Cost |
| ------------------------------------------- | ----------------------------------------- | ---------------------: | -----------------------: | -------------: |
| Router (classification + planning)          | Ollama (local)                            |              1600-3800 |                      3.5 |              0 |
| Router (fallback classification + planning) | OpenAI GPT-4o-mini                        |              2800-6200 |                      4.7 |              $ |
| General Chat                                | Ollama (local)                            |              2800-4200 |                      4.0 |              0 |
| Review Sentiment (basic)                    | Hugging Face (Python)                     |                200-800 |                      3.8 |              0 |
| Review Analysis (full)                      | OpenAI GPT-4o-mini                        |              2100-3900 |                      4.6 |              $ |
| RAG Retrieval (KB search)                   | Sentence-Transformers + ChromaDB (Python) |                 50-650 |                      5.0 |              0 |
| RAG Generation (final answer)               | OpenAI GPT-4o-mini                        |               900-2400 |                      4.6 |              $ |
| Orchestration Final Synthesis               | OpenAI GPT-4o-mini                        |              1300-3300 |                      4.5 |              $ |

## Analysis and Conclusions

### Why local vs cloud model split

- Local Ollama is used first for routing and general chat to reduce cost and keep latency predictable.
- OpenAI is used as fallback and for higher-quality tasks (structured planning fallback, RAG answer generation, final synthesis).
- This split balances cost, speed, and answer quality.

### Task partitioning

- The original version ran retrieval and sentiment in a separate Python service. Phase 1 moved retrieval into the TS server (Ollama embeddings + SQLite), so the stack is one process plus Ollama.
- Each LLM component's provider and model is configurable independently, so models can be swapped and compared per component.

### Main trade-offs in hybrid architecture

- Local models add a dependency on Ollama being up with the right models pulled.
- Tool chaining increases complexity and error handling needs.
- Placeholder-based orchestration is flexible but can propagate earlier step errors.
- Multi-model behavior can vary across providers and needs robust fallback logic.

### Future improvements

- Add stronger schema validation for router output with explicit error recovery plans.
- Add observability dashboard for latency and success rates per tool.
- Add multilingual embeddings and richer KB documents (PDF ingestion, metadata filtering).

## Notes

- Existing features from previous assignments (persona, guardrails, self-correction) remain integrated.
- For submission, include terminal screenshots/logs proving the required scenarios.
