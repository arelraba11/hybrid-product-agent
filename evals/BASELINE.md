# Eval baseline (phase 2)

The system as of the end of phase 2. Planner logic, `policy.ts`, hardcoded prices and rates, and `buildDeterministicFinanceMessage` are unchanged from phase 1. Use these numbers as the reference for phase 3 (remove hardcodes) and phase 4 (tool calling).

Reproduce with `bun run eval --config evals/configs/<config>.env --runs 3` (Ollama must be running for embeddings). The raw results with traces are in `evals/results/` (gitignored).

| Config                              | Date       | Commit    | Cases × runs | Overall         |
| ----------------------------------- | ---------- | --------- | ------------ | --------------- |
| openai-only                         | 2026-10-27 | `3c7a1dc` | 30 × 3       | **30/90 (33%)** |
| default (gemma4:12b planner + chat) | 2026-10-28 | `f378257` | 30 × 3       | **24/90 (27%)** |
| legacy (phi3 + gpt-4o-mini)         | 2026-10-28 | `f378257` | 30 × 3       | **66/90 (73%)** |

All three runs use the same planner prompt (`classifierPromptLocal` before step 2.6). The default and legacy runs include the `LLM_TIMEOUT_MS` / `<C>_MAX_TOKENS` / `<C>_THINK` robustness fixes (`a30995f`, `f378257`), which change no planner or tool logic. With `PLANNER_THINK=false` gemma4 never hits the limit or the timeout (planner max 124 output tokens, mean 0.9s).

> **Commit SHAs.** The openai-only run's results file says `b40d589`. That commit was rewritten to `3c7a1dc` by the 2026-10-27 rebase, which only amended commit messages; the trees are identical.

## Across configs

**Headline: the primary planner's parameter names decide the score.** Tool selection is about the same in every config (tools scorer 87–92%). What differs is whether the parameters survive `normalizeStep`:

- **gemma4 (default)** follows the prompt's only example and puts `userInput` in almost every tool, like gpt-5.4-mini in openai-only. Its plans always parse, so the fallback never fires (0%). `normalizeStep` nulls the parameters: args 7/54. A few non-`userInput` keys get through: `from`/`to`/`amount` for exchange (3/3), `location` for weather (1/3).
- **phi3 (legacy)** makes up plausible names (`product`, `productName`, `product_name`, `reviewText`, `location`, `fromCurrency`), and `normalizeStep`'s alias table in `policy.ts` maps them: args 51/54. On top of that, **27% of requests fall back** to gpt-4o-mini with the full `classifierPrompt`, which lists parameter names. All 24 fallback runs (8 cases × 3, deterministic) are the same failure: phi3 starts with ` ```json `, the ` ``` ` stop sequence fires after 1 token, and the plan comes back empty. So legacy's 73% leans on `policy.ts` aliases and on an accidental fallback to a planner that sees parameter names. It doesn't show phi3 is a better planner.
- **README scenarios** (smoke, `./scripts/smoke.sh` on the default `.env`, `f378257`): **1 of 5 work**. That's the PrintForge budget question, and `policy.ts` builds that math with the hardcoded `25`. Weather+FX loses the city, review+KB loses the product, and both RAG questions return `"Missing product_name parameter for product lookup."` Chit-chat works. Before `PLANNER_THINK=false`, all 5 passed only because the planner failed and gpt-5.4-mini did the planning as fallback (see the data point below). This is the 2.6 prompt problem showing, not a new bug.

| Case                        | openai-only | default | legacy | default failing scorers | legacy failing scorers    |
| --------------------------- | ----------- | ------- | ------ | ----------------------- | ------------------------- |
| st-weather-paris            | 0           | 1       | 3 (fb) | args×2 contains×2       |                           |
| st-fx-convert-eur           | 3           | 3       | 3 (fb) |                         |                           |
| st-math-expr                | 3           | 0       | 0      | tools×3 contains×3      | tools×3 contains×3        |
| st-math-word                | 3           | 0       | 3 (fb) | tools×3 contains×3      |                           |
| st-review                   | 0           | 0       | 0      | tools×3                 | tools×3                   |
| rag-evophone-ram            | 0           | 0       | 3      | args×3 contains×3       |                           |
| rag-evophone-battery        | 0           | 0       | 3 (fb) | args×3 contains×3       |                           |
| rag-brewmaster-tank         | 0           | 0       | 3      | args×3 contains×3       |                           |
| rag-electroride-range       | 0           | 0       | 3      | args×3 contains×3       |                           |
| rag-printforge-promo        | 0           | 0       | 3      | args×3 contains×3       |                           |
| rag-printforge-after-promo  | 0           | 0       | 0      | args×3 contains×3       | tools×3 args×3 contains×3 |
| rag-aurora-battery          | 0           | 0       | 3      | args×3 contains×3       |                           |
| rag-skyline-price           | 0           | 0       | 3      | args×3 contains×3       |                           |
| mt-weather-fx               | 0           | 0       | 3      | args×3                  |                           |
| mt-review-rag               | 3           | 0       | 3 (fb) | args×3 contains×3       |                           |
| mt-budget-printforge        | 3           | 3       | 3      |                         |                           |
| mt-budget-skyline           | 0           | 0       | 3      | args×3 derived×3        |                           |
| mt-missing-evophone         | 0           | 0       | 3      | tools×3                 |                           |
| mt-missing-aurora           | 0           | 0       | 3      | args×3 derived×3        |                           |
| mt-total-brewmaster-neobook | 0           | 0       | 0      | args×3 derived×3        | derived×3                 |
| mt-total-tidal-aurora       | 0           | 0       | 0 (fb) | args×3 derived×3        | tools×3                   |
| up-galaxy-ram               | 0           | 2       | 3      | judge×1                 |                           |
| up-evophone-z-price         | 0           | 0       | 0      | judge×3                 | not_contains×3            |
| up-pixelpad-budget          | 3           | 3       | 0      |                         | judge×3                   |
| cc-greeting                 | 3           | 3       | 3 (fb) |                         |                           |
| cc-lakehouse                | 3           | 3       | 3 (fb) |                         |                           |
| cc-joke                     | 3           | 3       | 3      |                         |                           |
| amb-printforge-price        | 0           | 0       | 3      | args×3 contains×3       |                           |
| amb-battery-no-product      | 3           | 3       | 3      |                         |                           |
| amb-drone-price             | 0           | 0       | 0      | contains×3              | contains×3                |

Passes are out of 3. `(fb)` = every run used the fallback planner (gpt-4o-mini). Every other cell is all-primary. Each case's planner source was the same in all 3 runs.

| Metric                                    | openai-only           | default               | legacy                |
| ----------------------------------------- | --------------------- | --------------------- | --------------------- |
| Overall                                   | 30/90 (33%)           | 24/90 (27%)           | 66/90 (73%)           |
| single-tool / rag / multi-tool            | 60% / 0% / 25%        | 27% / 0% / 13%        | 60% / 88% / 75%       |
| unknown-product / chit-chat / ambiguous   | 33% / 100% / 33%      | 56% / 100% / 33%      | 33% / 100% / 67%      |
| readme / new-product / hardcode-sensitive | 40% / 0% / 50%        | 20% / 0% / 50%        | 100% / 67% / 75%      |
| Scorers: tools / args / derived / judge   | 92% / 17% / 43% / 75% | 87% / 13% / 43% / 83% | 87% / 94% / 86% / 88% |
| Latency p50 / p95                         | 1.5s / 4.4s           | 1.1s / 3.7s           | 2.0s / 4.7s           |
| Tokens in / out (router)                  | 38,650 / 7,582        | 37,905 / 6,720        | 113,201 / 11,756      |
| Cost router / judge                       | $0.063 / $0.008       | $0.028 / $0.008       | $0.017 / $0.008       |
| Fallback / both planners failed           | 0% / 0%               | 0% / 0%               | 27% / 0%              |
| Deterministic (templated) answers         | 12%                   | 13%                   | 27%                   |
| `knownUsdPriceForProduct` as numericValue | 3%                    | 0%                    | 20%                   |
| Crashes                                   | 0                     | 0                     | 0                     |

Per-config notes:

- **default.** `st-math-*`: gemma4 sends `calculateMath {userInput: "(17 * 23) - 45"}`, and `sanitizeRoute` drops the step because the expression is null. The plan ends up empty and the answer is "I could not produce an answer for this request." (tools×3). openai-only passed these because gpt-5.4-mini happened to use `expression`. The default config costs less than openai-only because the planner and chat run locally.
- **legacy.** The RAG passes go through `normalizeStep` aliases. The 20% hardcode rate comes from `knownUsdPriceForProduct` attaching a `numericValue` to RAG steps, so legacy's price/budget passes (`mt-budget-skyline`, `mt-missing-*`) partly come from the hardcodes, like `mt-budget-printforge` everywhere. Tokens-in is about 3× higher mostly because RAG actually runs: 60 `rag` calls with 74.8k input tokens, against 6 calls and 7.5k in default. The fallback planner adds 11.7k. `up-evophone-z-price` puts a made-up price in the answer (`not_contains`), and `up-pixelpad-budget` fails the judge.
- **Shared failures** (independent of the planner model): `st-review` (the `sanitizeRoute` substring "ils" in "emails" adds an exchange step), `rag-printforge-after-promo`, `mt-total-*` (derived), `amb-drone-price` and `up-evophone-z-price`.

**For step 2.6:** the result to beat is default 24/90 with 0% fallback. If parameter names in `classifierPromptLocal` work, most of the args failures should turn into passes for default and openai-only. Legacy may change in either direction: the prompt change also affects phi3's naming and whether it fences its output (that is, its 27% fallback rate).

## Data point: default before `PLANNER_THINK` (2026-10-28, `a30995f`)

This isn't a baseline, just a record of why the default config needs `PLANNER_THINK=false`.

- **Symptom.** With `gemma4:12b` thinking at its default (on), the primary planner failed on almost every request. `st-fx-convert-eur` (1 run): fallback 1/1. `./scripts/smoke.sh`: 5 of 6 prompts went to the fallback planner (about 10s each). Only the chit-chat prompt got a plan.
- **Cause.** gemma4 has Ollama's _thinking_ capability, on by default. Ollama's `gemma4` parser moves the thought into a separate `thinking` field, and the provider reads only `response`. The planner spent its whole `PLANNER_MAX_TOKENS=512` thinking (`done_reason: length`, `eval_count` 512, ~1.7k chars of thinking). It had drafted a valid plan and was second-guessing `final_answer_synthesis_required` when it hit the limit. `response` was `""`, so parsing failed ("No JSON object found") and the fallback (`gpt-5.4-mini`) did the planning. The planner's stop sequences don't cut the thinking short. Before `PLANNER_MAX_TOKENS` and `LLM_TIMEOUT_MS` existed, the same thing showed up as a hang.
- **Fix.** `<C>_THINK` (`f378257`), with `PLANNER_THINK=false` and `CHAT_THINK=false` in `default.env`. With it, the same request returns one line of JSON after 37 tokens in ~1s.

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
