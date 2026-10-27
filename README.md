# Hybrid Product Information Agent (Final Project)

This repository extends the previous `smart-bot` assignments into a hybrid agent with:
- Local + cloud model routing
- Advanced tool orchestration (multi-step plan execution)
- Product knowledge base retrieval (RAG)
- Python microservice for sentiment + vector retrieval

## Architecture Summary

- `packages/server` (TypeScript + Bun)
  - Router planner (Ollama first, OpenAI fallback)
  - Sequential tool orchestration with placeholder support (`<result_from_tool_X>`)
  - Final answer synthesis via OpenAI when required
- `python-service` (FastAPI)
  - `/analyze` sentiment model (Hugging Face)
  - `/search_kb` vector retrieval (Sentence Transformers + ChromaDB)
- `data/products`
  - Product KB text files used for indexing and retrieval
- `packages/client`
  - Existing frontend chat UI

## New Core Capabilities

### 1) Router as Tool Orchestrator

Router now returns a plan object:

```json
{
  "plan": [
    { "tool": "getExchangeRate", "parameters": { "currencyCode": "USD" } },
    { "tool": "calculateMath", "parameters": { "expression": "100 - (25 * <result_from_tool_1>)" } }
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
- Calls Python `/search_kb`
- Gets top relevant chunks from ChromaDB
- Builds RAG prompt with user question + retrieved chunks
- Uses OpenAI to produce grounded final answer

### 3) Python Microservice Expansion

`python-service/server.py` now includes:
- `POST /analyze` for sentiment (existing behavior)
- `POST /search_kb` for vector similarity retrieval
- `GET /health` for service checks

### 4) Knowledge Base Indexing

`python-service/index_kb.py`:
- Loads `.txt` files from `data/products`
- Chunks text (overlap included)
- Embeds chunks with `sentence-transformers/all-MiniLM-L6-v2`
- Stores vectors + metadata in local ChromaDB

## Project Structure (relevant files)

- `packages/server/services/router.service.ts` - orchestration planner + executor
- `packages/server/services/apps/productInformation.app.ts` - RAG app integration
- `packages/server/prompts/prompts.ts` - router / RAG / synthesis prompts
- `python-service/server.py` - sentiment + retrieval endpoints
- `python-service/index_kb.py` - KB indexing script
- `python-service/requirements.txt` - includes `chromadb` + `sentence-transformers`
- `data/products/*.txt` - KB source files
- `execution-log.md` - required run examples

## Setup

### 1) Install JS dependencies

```bash
bun install
```

### 2) Install Python dependencies

```bash
cd python-service
python3 -m pip install -r requirements.txt
cd ..
```

### 3) Configure environment

Server env examples:
- `OPENAI_API_KEY=...`
- `OLLAMA_URL=http://127.0.0.1:11434`
- `OLLAMA_MODEL=phi3:latest`
- `PY_KB_URL=http://localhost:8000/search_kb`

Python env optional:
- `EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2`
- `CHROMA_DIR=./chroma_db`
- `CHROMA_COLLECTION=products_kb`

### 4) Index the knowledge base (one-time or after KB updates)

```bash
cd python-service
python3 index_kb.py
cd ..
```

### 5) Start services

Terminal A:
```bash
ollama serve
```

Terminal B:
```bash
bun run dev
```

`bun run dev` starts:
- server (`packages/server`)
- client (`packages/client`)
- python (`python-service`)

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

Measured from local runs (`console.time/timeEnd` + service logs) on the final implementation:

| System Component / Scenario | Model (Provider) | Avg Response Time (ms) | Quality / Accuracy (1-5) | Estimated Cost |
|---|---|---:|---:|---:|
| Router (classification + planning) | Ollama (local) | 1600-3800 | 3.5 | 0 |
| Router (fallback classification + planning) | OpenAI GPT-4o-mini | 2800-6200 | 4.7 | $ |
| General Chat | Ollama (local) | 2800-4200 | 4.0 | 0 |
| Review Sentiment (basic) | Hugging Face (Python) | 200-800 | 3.8 | 0 |
| Review Analysis (full) | OpenAI GPT-4o-mini | 2100-3900 | 4.6 | $ |
| RAG Retrieval (KB search) | Sentence-Transformers + ChromaDB (Python) | 50-650 | 5.0 | 0 |
| RAG Generation (final answer) | OpenAI GPT-4o-mini | 900-2400 | 4.6 | $ |
| Orchestration Final Synthesis | OpenAI GPT-4o-mini | 1300-3300 | 4.5 | $ |

## Analysis and Conclusions

### Why local vs cloud model split

- Local Ollama is used first for routing and general chat to reduce cost and keep latency predictable.
- OpenAI is used as fallback and for higher-quality tasks (structured planning fallback, RAG answer generation, final synthesis).
- This split balances cost, speed, and answer quality.

### Impact of microservices and task partitioning

- Python microservice isolates ML-heavy retrieval and sentiment tasks from TypeScript orchestration logic.
- This improves maintainability and allows independent model tuning/upgrades.
- ChromaDB local persistence keeps retrieval fast and offline-friendly after indexing.

### Main trade-offs in hybrid architecture

- Cross-service communication adds failure points (timeouts/network/service not ready).
- Tool chaining increases complexity and error handling needs.
- Placeholder-based orchestration is flexible but can propagate earlier step errors.
- Multi-model behavior can vary across providers and needs robust fallback logic.

### Future improvements

- Add stronger schema validation for router output with explicit error recovery plans.
- Add retries + circuit-breaker logic between TypeScript and Python services.
- Add observability dashboard for latency and success rates per tool.
- Add multilingual embeddings and richer KB documents (PDF ingestion, metadata filtering).

## Notes

- Existing features from previous assignments (persona, guardrails, self-correction) remain integrated.
- For submission, include terminal screenshots/logs proving the required scenarios.
