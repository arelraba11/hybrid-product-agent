# Eval baseline (phase 2)

The system as of the end of phase 2. Planner logic, `policy.ts`, hardcoded prices and rates, and `buildDeterministicFinanceMessage` are unchanged from phase 1. Use these numbers as the reference for phase 3 (remove hardcodes) and phase 4 (tool calling).

Reproduce with `bun run eval --config evals/configs/<config>.env --runs 3` (Ollama must be running for embeddings). The raw results with traces are in `evals/results/` (gitignored).

| Config                              | Date       | Commit    | Cases × runs | Overall         |
| ----------------------------------- | ---------- | --------- | ------------ | --------------- |
| openai-only                         | 2026-10-27 | `3c7a1dc` | 30 × 3       | **30/90 (33%)** |
| default (gemma4:12b planner + chat) | 2026-10-28 | `f378257` | 30 × 3       | **24/90 (27%)** |
| legacy (phi3 + gpt-4o-mini)         | 2026-10-28 | `f378257` | 30 × 3       | **66/90 (73%)** |
| openai-only, re-run before 2.6      | 2026-10-28 | `b8794c3` | 30 × 3       | **27/90 (30%)** |
| **after 2.6:** openai-only          | 2026-10-28 | `006458d` | 30 × 3       | **78/90 (87%)** |
| **after 2.6:** default              | 2026-10-28 | `006458d` | 30 × 3       | **76/90 (84%)** |
| **after 2.6:** legacy               | 2026-10-28 | `006458d` | 30 × 3       | **72/90 (80%)** |
| **phase 3 reference:** default      | 2026-10-28 | `6c3f98a` | 30 × 3       | **80/90 (89%)** |

All three runs use the same planner prompt (`classifierPromptLocal` before step 2.6). The default and legacy runs include the `LLM_TIMEOUT_MS` / `<C>_MAX_TOKENS` / `<C>_THINK` robustness fixes (`a30995f`, `f378257`), which change no planner or tool logic. With `PLANNER_THINK=false` gemma4 never hits the limit or the timeout (planner max 124 output tokens, mean 0.9s).

> **Commit SHAs.** The openai-only run's results file says `b40d589`. That commit was rewritten to `3c7a1dc` by the 2026-10-27 rebase, which only amended commit messages; the trees are identical.

## Phase 3 reference: default at `6c3f98a` (2026-10-28)

**Compare every phase 3 step against this run** (`bun run eval --config evals/configs/default.env --runs 3`). It is the end of phase 2: step 2.6 plus the eval-hygiene commit `6c3f98a`:

- **Fallback prompt (`classifierPrompt`):** its few-shot examples no longer reuse golden-set inputs. They now use Berlin + GBP, a blender review, a product that isn't in the KB, and 750 ILS / 40 EUR. Prompt-only.
- **`amb-drone-price`:** scored by a judge rubric now (asks which drone, OR gives 689 USD, the only drone in the KB) instead of any-of phrases, which rejected reasonable clarifying answers.

| Category        | Pass      | Rate    |     | Scorer       | Pass  | Rate |
| --------------- | --------- | ------- | --- | ------------ | ----- | ---- |
| single-tool     | 12/15     | 80%     |     | tools        | 81/90 | 90%  |
| rag             | 24/24     | 100%    |     | args         | 54/54 | 100% |
| multi-tool      | 18/24     | 75%     |     | contains     | 45/45 | 100% |
| unknown-product | 8/9       | 89%     |     | not_contains | 9/9   | 100% |
| chit-chat       | 9/9       | 100%    |     | derived      | 18/21 | 86%  |
| ambiguous       | 9/9       | 100%    |     | judge        | 26/27 | 96%  |
| **overall**     | **80/90** | **89%** |     |              |       |      |

| Metric                                                      | Value                                              |
| ----------------------------------------------------------- | -------------------------------------------------- |
| Tags: readme / new-product / hardcode-sensitive / fx-static | 100% / 83% / 75% / 74%                             |
| Latency p50 / p95                                           | 2.1s / 5.1s                                        |
| Tokens in / out (router)                                    | 153,838 / 8,991                                    |
| Cost router / judge                                         | $0.090 / $0.009                                    |
| Fallback / both planners failed                             | 7% / 0% (`st-math-*` 3/3 each, gemma4 broken JSON) |
| Deterministic (templated) answers                           | 14%                                                |
| `knownUsdPriceForProduct` as numericValue                   | 23%                                                |
| Crashes                                                     | 0                                                  |

**Failing (10 runs):** `st-review` 0/3 (tools; "ils" in "emails"), `mt-total-brewmaster-neobook` 0/3 (tools + derived; `sanitizeRoute` rewrite + `extractUsdAmount` "14"), `mt-total-tidal-aurora` 0/3 (tools; rewrite), `up-pixelpad-budget` 2/3 (the 1 failure is the templated "You will have 1000 ILS remaining.").

**76 → 80 compared with `006458d`:** `amb-drone-price` 0 → 3 is the rubric change. `up-pixelpad-budget` 0 → 2 and `mt-missing-evophone`/`-aurora` 2 → 3 are run-to-run variance: the plans are identical and there was no fallback. `up-pixelpad-budget` lands on the templated answer only when the RAG wording makes `buildDeterministicFinanceMessage` fire. The fallback-prompt change only affects fallback runs, which are both `st-math-*` cases, and those still pass 3/3. So take ±2 runs as noise when reading phase 3 deltas.

**What phase 3 should move:** (a) removing `knownUsdPriceForProduct` shows which price passes depended on it, starting from the 23% hardcode rate. (b) removing `buildDeterministicFinanceMessage` should fix `up-pixelpad-budget`'s templated failure, change the 14% deterministic answers, and turn `mt-total-brewmaster-neobook`'s wrong 1361.25 into a synthesis answer. (c) live FX changes the `fx-static` numbers but not their scoring (derived reads the rate from the trace).

## Phase 3

Default config, `--runs 3`, one row per step. Δ is against the 80/90 reference above; ±2 is noise.

| Step                                 | Commit    | Overall         | Δ   | tools / derived / judge | Fallback | Templated   | Hardcode price |
| ------------------------------------ | --------- | --------------- | --- | ----------------------- | -------- | ----------- | -------------- |
| reference                            | `6c3f98a` | 80/90 (89%)     | —   | 81 / 18/21 / 26/27      | 7%       | 14%         | 23%            |
| 3.1 token/prefix KB product filter   | `bbe2251` | **76/90 (84%)** | −4  | 81 / 19/21 / 24/27      | 7%       | 17%         | 20%            |
| 3.2 remove `knownUsdPriceForProduct` | `d91c5b0` | **78/90 (87%)** | −2  | 81 / 21/21 / 24/27      | 7%       | 16%         | — (removed)    |
| 3.3 remove templated finance answers | `c11bf8d` | **81/90 (90%)** | +1  | 81 / 21/21 / 27/27      | 7%       | — (removed) | —              |
| 3.4 live FX rates (Frankfurter)      | `b000191` | **72/90 (80%)** | −8  | 81 / 12/21 / 27/27      | 7%       | —           | —              |

**3.1:** the filter now resolves `BrewMaster Y` → `brewmaster y coffee machine` and `NeoBook Air 14` → `neobook air 14 laptop`. `EvoPhone Z` / `PixelPad Pro` match nothing and use the global search, as before. Retrieval for "What is the price in USD?" + NeoBook used to return ElectroRide/PrintForge/Skyline chunks and now returns only NeoBook chunks. `mt-total-brewmaster-neobook`: NeoBook's `numericValue` is **1099** (`output`, was 14), the answer is 5,430 ILS, and **derived goes 0 → 3/3**. The case still fails on tools (the `sanitizeRoute` 5-step rewrite, phase 4).

The −4 is outside the noise band, but neither losing case passes through code that 3.1 changed. Both have identical plans and tool outputs to the reference:

- `mt-missing-aurora` 3 → 1: `Aurora Smartwatch S3` matched exactly before 3.1 too. The math step is `((249) * ) - 500` in both runs (see the stale-index bug below), so synthesis does the arithmetic, and in 2 runs gpt-5.4-mini wrote 249 × 3.75 = **934.75** (it's 933.75). LLM arithmetic variance on a broken math step.
- `up-pixelpad-budget` 2 → 0: no name matches, so global search, the same as before. The RAG wording was "The KB does not contain pricing…" in all 3 runs. The math evaluated that to 1000, and the templated "You will have 1000 ILS remaining." fired. The reference notes the same wording-dependent variance. 3.3 removes the template.

**Found (pre-existing, `policy.ts`, phase 4):** in budget questions that mention "ILS", `looksLikeExchangeQuestion` appends `getExchangeRate` _after_ the planner's math step. The budget branch then reads `exchangeIndex` before filtering out `calculateMath`. The stale index makes the rebuilt math reference itself (`<result_from_tool_3>` → empty), so the math step fails and synthesis does the arithmetic (`mt-missing-aurora`, `mt-missing-evophone`). The reference run has the same expressions.

**3.2:** within noise. Every product price that used to come from the table now comes from the RAG output (`numericSource: output`): PrintForge 25, EvoPhone X 799, BrewMaster 349, NeoBook 1099. All `hardcode-sensitive` budget/total cases keep their numbers, derived is **21/21** (was 18/21 in the reference, 19/21 after 3.1), and `mt-budget-printforge` stays 3/3 (math `100 - ((25) * 3.75)`, with 25 now from RAG). `mt-missing-aurora` is back to 3/3 (variance, as above). Changes: `up-pixelpad-budget` 0 → 1 (the templated answer still fires on 2 runs, 3.3) and `amb-drone-price` 3 → 2 (judge: the answer adds the KB's Fly More Kit price; the drone was never in the table).

**3.3:** within noise overall, but the failure set has changed. All 9 failing runs are now the three tool-sequence failures from `sanitizeRoute` (`st-review`, `mt-total-*`, phase 4), and **judge is 27/27**. The answers that the template used to produce now come from synthesis:

- `up-pixelpad-budget` **3/3** (was 2/3 in the reference, 0/3 after 3.1): "I can't determine how much ILS you'll have left because the price of the **PixelPad Pro** isn't available in the knowledge base…". It used to say "You will have 1000 ILS remaining."
- `mt-total-brewmaster-neobook`: "349 USD + 1,099 USD = 1,448 USD … **5,430 ILS**". It used to say "The total is 1361.25 ILS." (reference). Derived 3/3, still tools ✗.
- `mt-total-tidal-aurora`: "**2,542.5 ILS**" with the per-product breakdown.

Cost: router $0.090 → $0.099 and tokens in 155k → 161k, because synthesis now runs on the ~15% of requests that used to be templated.

**3.4:** rates are live ECB rates on 2026-10-28: USD 3.1259, EUR 3.4801 (were 3.75 / 4.05). **−8 is a real regression, and its cause is pre-existing.** All 9 lost runs are derived failures on the three cases whose math step references itself because of the stale `exchangeIndex` in `sanitizeRoute` (logged under 3.1): `mt-budget-skyline` `3000 - ((689) * )`, `mt-missing-evophone` `((799) * ) - 2500`, `mt-missing-aurora` `((249) * ) - 500`. The math tool fails, so synthesis multiplies by itself. At 3.75 it got that right; at 3.1259 it doesn't. For example, 689 × 3.1259 comes out as 2153.6 / 2153.8 / 2153.28 (it's 2153.75), and 249 × 3.1259 as 778.6 / 778.85 (it's 778.35). Every case where the math tool actually runs still passes at the live rate: `st-fx-convert-eur` 696.02, `mt-budget-printforge` 21.85, the `mt-total-*` derived values 4,526.30 / 2,119.36. Judge is unchanged at 27/27. **So the static 3.75 was hiding the `sanitizeRoute` bug: the case passed only because synthesis could do the arithmetic in its head.** The fix is either the one-line index fix in `policy.ts` or phase 4, where the math step gets real references.

FX behavior (unit-tested with a mocked fetch and clock in `services/apps/exchange.app.test.ts`): 1 h fresh cache. A failed refresh serves a cached rate up to 24 h old, labeled; after that, or with no cache, the tool returns an error string with no number. 404 → "I don't have a rate for X". The live API took ~50–130 ms per currency, and repeats are cache hits.

**Phase 3 summary:** the price table, templated answers and static rates are gone, and the KB filter matches real product names. Default goes 80 → 72/90, and the whole −8 is the `sanitizeRoute` math bug above (81/90 before live rates). Remaining failures, all `policy.ts` (phase 4): `st-review` ("ils" in "emails"), `mt-total-*` (5-step rewrite, tools only, numbers right), `mt-budget-skyline` / `mt-missing-*` (stale `exchangeIndex`).

## Step 2.6: planner prompt fix (`006458d`)

This is a prompt-only change to `classifierPromptLocal`. It lists each tool with its exact canonical parameter names (`city`, `currencyCode`, `expression`, `reviewText`, `product_name` + `query`, `userInput`), gives one example per tool plus one chaining example, and adds an explicit "raw JSON only, no code fences" rule. None of the examples come from `evals/cases.json`: they use Tokyo, GBP, 12 \* 9 + 4, 900 ILS / 60 GBP and a "Nimbus Kettle K2" that isn't in the KB. The only token they share with the golden set is the digit `2`. Code, `policy.ts`, stop sequences and the fallback prompt are unchanged.

"Before" is the phase 2 baseline at `f378257` for default and legacy. For openai-only it's a re-run at `b8794c3` (27/90), because the 2026-10-27 run (30/90) predates the eval env fix. The 3-pass gap between those two is gpt-5.4-mini's run-to-run variance; both runs are all-primary.

### Before → after

| Category        | openai-only       | default           | legacy            |
| --------------- | ----------------- | ----------------- | ----------------- |
| single-tool     | 6/15 → 12/15      | 4/15 → 12/15      | 9/15 → 12/15      |
| rag             | 0/24 → **24/24**  | 0/24 → **24/24**  | 21/24 → 24/24     |
| multi-tool      | 6/24 → 18/24      | 3/24 → 16/24      | 18/24 → 15/24     |
| unknown-product | 3/9 → 9/9         | 5/9 → 6/9         | 3/9 → 6/9         |
| chit-chat       | 9/9 → 9/9         | 9/9 → 9/9         | 9/9 → 9/9         |
| ambiguous       | 3/9 → 6/9         | 3/9 → 9/9         | 6/9 → 6/9         |
| **overall**     | **27 → 78 (87%)** | **24 → 76 (84%)** | **66 → 72 (80%)** |

| Metric                                    | openai-only           | default               | legacy                |
| ----------------------------------------- | --------------------- | --------------------- | --------------------- |
| Scorer args                               | 17% → 100%            | 13% → 100%            | 94% → 100%            |
| Scorer contains / derived / judge         | 25/43/75 → 94/86/100% | 15/43/83 → 100/76/88% | 81/86/88 → 100/71/83% |
| Scorer tools                              | 90% → 90%             | 87% → 90%             | 87% → 87%             |
| readme / new-product / hardcode-sensitive | 40/0/50 → 100/67/75%  | 20/0/50 → 100/78/67%  | 100/67/75 → 80/83/75% |
| Fallback rate                             | 0% → 0%               | 0% → 7%               | 27% → 16%             |
| Deterministic (templated) answers         | 13% → 17%             | 13% → 17%             | 27% → 20%             |
| `knownUsdPriceForProduct` as numericValue | 3% → 23%              | 0% → 23%              | 20% → 20%             |
| Latency p50 / p95                         | 1.5/3.8s → 2.2/4.2s   | 1.1/3.7s → 2.0/4.5s   | 2.0/4.7s → 2.6/6.6s   |
| Tokens in (router)                        | 38.6k → 141.9k        | 37.9k → 152.9k        | 113.2k → 175.1k       |
| Cost router (90 runs)                     | $0.062 → $0.144       | $0.028 → $0.089       | $0.017 → $0.020       |

Smoke (`./scripts/smoke.sh`, default `.env`, `006458d`): **all 5 README scenarios + chat work**, with all 6 planned by gemma4 (0 fallbacks, ~1s per plan once the model is loaded). Before 2.6 only 1 of 5 worked.

**Reading the deltas**

- The primary planners now use the right parameter names: args 100% in all three configs. RAG goes 0 → 24/24 for both models that used to send `userInput`, and the `filter-mismatch` case passes everywhere.
- Latency, tokens and cost go up because tools actually run now, RAG especially. A request that used to stop at `"Missing product_name parameter"` now does retrieval plus generation. It isn't a regression. Default costs about $0.001 per request.
- The `knownUsdPriceForProduct` rate jumps to 23% for the same reason: product steps now carry real product names, so the hardcoded table matches them. Its effect on passes is limited. On RAG-only cases (RAM, battery) the `numericValue` it attaches goes unused, because the answer is the RAG text. On `mt-total-brewmaster-neobook` the hardcoded 349 matches the KB.
- **default fallback 7%** is detectable and works as designed: gemma4 writes unterminated JSON for both `st-math-*` cases (a `}` is missing after the expression), and the fallback produces the right plan (3/3 each).
- **legacy fallback 16%:** the no-fences rule cut phi3's ` ```json ` rate from 8 to 5 cases, but it's still the 1-token stop (14/14 fallback runs). Legacy's multi-tool score drops 18 → 15 and readme 15 → 12. That's because `mt-review-rag` is now planned by phi3 itself (it used to fall back to gpt-4o-mini) and gets the tools wrong.

### What still fails after 2.6, and where it lives

| Case                         | Configs       | Cause                                                                                                                                                                                                                                                                                                                              | Lives in                                          |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| st-review                    | all           | `looksLikeExchangeQuestion` matches "ils" in "em**ails**" and adds `getExchangeRate`.                                                                                                                                                                                                                                              | `policy.ts` (`sanitizeRoute`)                     |
| mt-total-brewmaster-neobook  | all           | The planner's plan is right (2× product, math). `sanitizeRoute` rewrites it into 5 steps with an extra `calculateMath` (tools ✗). NeoBook's `numericValue` is **14**, taken from the name "NeoBook Air 14" instead of 1,099 USD, so the templated answer is a confident **"The total is 1361.25 ILS."** The right answer is 5,430. | `policy.ts`, numeric extraction, `postprocess.ts` |
| mt-total-tidal-aurora        | all           | Same 5-step rewrite (tools ✗). The number itself is right in default/openai-only (2,542.50).                                                                                                                                                                                                                                       | `policy.ts`                                       |
| up-pixelpad-budget           | default       | The product isn't in the KB, so `numericValue` is null and the templated answer says **"You will have 1000 ILS remaining."** (judge ✗ 3/3).                                                                                                                                                                                        | `postprocess.ts`                                  |
| mt-missing-evophone / aurora | default (1/3) | derived off in 1 of 3 runs.                                                                                                                                                                                                                                                                                                        | n/a (variance)                                    |
| amb-drone-price              | openai-only   | The answer ("share the model…") is reasonable, but the any-of phrases want "which model"/"specify". Scorer brittleness, not a system bug.                                                                                                                                                                                          | `evals/cases.json`                                |
| legacy-only                  | legacy        | `mt-review-rag` tools ✗ (phi3 plan), `up-evophone-z-price` makes up a price, `amb-battery-no-product` judge ✗, and the 16% fence fallback.                                                                                                                                                                                         | phi3 as planner / chat                            |

Note: the **fallback prompt's** few-shot examples (`classifierPrompt`) are golden-set inputs (Paris + USD, the EvoPhone review, EvoPhone X RAM, 100 ILS / 25 USD). Any case that falls back is partly measuring memorization. It doesn't matter for default or openai-only here (≤7% fallback), but it inflates legacy before 2.6. Unchanged by 2.6, as specified.

## Phase 2 baselines across configs (before 2.6)

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
