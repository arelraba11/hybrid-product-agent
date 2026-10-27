# Eval baseline (phase 2)

The system as of the end of phase 2. Planner logic, `policy.ts`, hardcoded prices and rates, and `buildDeterministicFinanceMessage` are unchanged from phase 1. Use these numbers as the reference for phase 3 (remove hardcodes) and phase 4 (tool calling).

Reproduce with `bun run eval --config evals/configs/<config>.env --runs 3` (Ollama must be running for embeddings). The raw results with traces are in `evals/results/` (gitignored).

| Config                              | Date                    | Commit    | Cases × runs | Overall         |
| ----------------------------------- | ----------------------- | --------- | ------------ | --------------- |
| openai-only                         | 2026-10-27              | `b40d589` | 30 × 3       | **30/90 (33%)** |
| default (gemma4:12b planner + chat) | _pending (run at home)_ |           |              |                 |
| legacy (phi3 + gpt-4o-mini)         | _pending (run at home)_ |           |              |                 |

## openai-only

All LLM components run on `gpt-5.4-mini` (embeddings stay local with `embeddinggemma`, judge `gpt-5.4-mini`).

> **This config isn't representative of the planner.** The primary planner always gets `classifierPromptLocal`, whatever its provider (`router.service.ts`, `classifyWithPlanner`). That prompt names the tools but never their parameters, and its only example is `{"userInput": ...}`. gpt-5.4-mini follows it literally and puts `userInput` in every tool, and `normalizeStep` then turns that into `null`. The plan still parses, so the fallback planner (whose prompt does list parameter names) never fires: the fallback rate is 0% and all 90 runs show `plannerSource: primary`. gemma4 and phi3 as primary get the same prompt, so the default and legacy runs will show whether they also copy `userInput`. This is listed in CLAUDE.md known issues as a phase 4 candidate.

> **Judge caveat.** In this config the judge and the system under test share a model (gpt-5.4-mini), so judge-scored cases may be biased upward. The judge stays gpt-5.4-mini in every config so scores remain comparable across configs.

### By category

| Category        | Pass      | Rate    |
| --------------- | --------- | ------- |
| single-tool     | 9/15      | 60%     |
| rag             | 0/24      | 0%      |
| multi-tool      | 6/24      | 25%     |
| unknown-product | 3/9       | 33%     |
| chit-chat       | 9/9       | 100%    |
| ambiguous       | 3/9       | 33%     |
| **overall**     | **30/90** | **33%** |

### By tag and scorer

| Tag                | Pass | Rate |     | Scorer       | Pass  | Rate |
| ------------------ | ---- | ---- | --- | ------------ | ----- | ---- |
| hardcode-sensitive | 6/12 | 50%  |     | tools        | 83/90 | 92%  |
| new-product        | 0/18 | 0%   |     | args         | 9/54  | 17%  |
| fx-static          | 9/27 | 33%  |     | contains     | 15/48 | 31%  |
| readme             | 6/15 | 40%  |     | not_contains | 9/9   | 100% |
| filter-mismatch    | 0/3  | 0%   |     | derived      | 9/21  | 43%  |
| smoke              | 3/3  | 100% |     | judge        | 18/24 | 75%  |

### Cost, latency, routing

| Metric                                    | Value                                   |
| ----------------------------------------- | --------------------------------------- |
| Latency p50 / p95 (per request)           | 1.5s / 4.4s                             |
| Tokens in / out (router, 90 runs)         | 38,650 / 7,582                          |
| Cost: router / judge                      | $0.063 / $0.008 (≈ $0.0007 per request) |
| Fallback rate / both planners failed      | 0% / 0%                                 |
| Deterministic (templated) answers         | 12%                                     |
| `knownUsdPriceForProduct` as numericValue | 3% (undercounts; see below)             |
| Crashes                                   | 0                                       |

### Per case (passes out of 3)

| Case                        | Pass | Failing scorers            |
| --------------------------- | ---- | -------------------------- |
| st-weather-paris            | 0    | args, contains             |
| st-fx-convert-eur           | 3    |                            |
| st-math-expr                | 3    |                            |
| st-math-word                | 3    |                            |
| st-review                   | 0    | tools                      |
| rag-evophone-ram            | 0    | args, contains             |
| rag-evophone-battery        | 0    | args, contains             |
| rag-brewmaster-tank         | 0    | args, contains             |
| rag-electroride-range       | 0    | args, contains             |
| rag-printforge-promo        | 0    | args, contains             |
| rag-printforge-after-promo  | 0    | args, contains             |
| rag-aurora-battery          | 0    | args, contains             |
| rag-skyline-price           | 0    | args, contains             |
| mt-weather-fx               | 0    | args                       |
| mt-review-rag               | 3    |                            |
| mt-budget-printforge        | 3    |                            |
| mt-budget-skyline           | 0    | args, derived              |
| mt-missing-evophone         | 0    | tools                      |
| mt-missing-aurora           | 0    | args, derived              |
| mt-total-brewmaster-neobook | 0    | args, derived              |
| mt-total-tidal-aurora       | 0    | args, derived (+ tools ×1) |
| up-galaxy-ram               | 0    | judge                      |
| up-evophone-z-price         | 0    | judge                      |
| up-pixelpad-budget          | 3    |                            |
| cc-greeting                 | 3    |                            |
| cc-lakehouse                | 3    |                            |
| cc-joke                     | 3    |                            |
| amb-printforge-price        | 0    | args, contains             |
| amb-battery-no-product      | 3    |                            |
| amb-drone-price             | 0    | contains                   |

## What's failing

1. **Parameter-less primary planner (most failures).** Every RAG case, both weather cases, all new-product cases, both unknown-product judge failures and `amb-drone-price` end up with `product_name: null` / `city: null`. The user then gets `"Missing product_name parameter for product lookup."` as the final answer (`answerSource: lastStep`), or a synthesis that explains the missing parameter. RAG retrieval itself is never exercised in these runs, so the KB expansion and the `filter-mismatch` case aren't really measured yet in this config. Tool _selection_ is mostly right (tools scorer 92%); the arguments are what's lost.
2. **Passes that come from the hardcodes.** All three hardcode-sensitive passes per case come from `policy.ts`, not the model:
   - `mt-budget-printforge` passes because `sanitizeRoute` adds the product step and builds the math expression with the hardcoded `25`, and the templated finance message phrases the answer.
   - `mt-missing-evophone` gets the right number the same way (`((799) * <rate>) - 2500`). It fails only on tools, because `sanitizeRoute` _adds_ a second `getProductInformation` next to the planner's null-param one.
   - The new-product twins (`mt-budget-skyline`, `mt-missing-aurora`, `mt-total-tidal-aurora`) all fail: hardcode-sensitive passes 50% vs new-product 0%.
   - Note that the trace's `hardcode` numericSource metric (3%) undercounts this. `sanitizeRoute` puts the hardcoded price straight into the math expression, so no step reports it as a `numericValue`.
3. **Confidently wrong templated answer.** In `mt-total-tidal-aurora`, the null product names give empty placeholders, the math evaluates to 0, and `buildDeterministicFinanceMessage` returns **"The total is 0 ILS."** No error is shown to the user. Phase 3 removes this path.
4. **Keyword rewrites in `sanitizeRoute` misfire.** `st-review` fails 3/3 because `looksLikeExchangeQuestion` matches the substring `ils` in "em**ails**", which adds a `getExchangeRate` step to a pure review analysis. The synthesized answer is still good (the judge passed it), but the plan is wrong.
5. **What works.** Math (direct and word problems), EUR conversion, chit-chat (100%, judge-scored), the review+RAG README scenario (that planner output happened to use `productName`, which `normalizeStep` maps), and the no-product ambiguity/unknown-budget cases, where the synthesis honestly reports what's missing.

### Read with care

- `fx-static` cases depend on the hardcoded rates (USD 3.75, EUR 4.05). The derived scorer reads the rate from the trace, so these cases stay valid when rates become live in phase 3.
- `mt-weather-fx` passes `contains: paris` even though the weather lookup failed, because the synthesis mentions Paris while explaining the failure. The `args` scorer is what catches it.
- Only 3 runs per case. Every case here was either 0/3 or 3/3 except `mt-total-tidal-aurora`'s tools scorer, so the variance looks low, but don't over-read single-case differences.
