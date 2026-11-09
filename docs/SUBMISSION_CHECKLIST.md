# Build and submission checklist

## Build sequence

| Phase | Work | Completion evidence |
|---|---|---|
| 1. Browser foundation | Observer and executor driven by local fixture/manual actions | Browser opens, inspects controls, executes actions and saves screenshots |
| 2. Agent loop | LLM client, prompt, Zod action schema, one-action loop and verdict function | A natural-language test is executed without site-specific code |
| 3. Reporting | Console step logs, trace, HTML report, redaction and exit codes | Every run has reviewable evidence |
| 4. Reliability | Error feedback, step limit, repeated-action guard, weak-evidence warning and origin policy | Expected FAIL and ERROR scenarios are correctly distinguished |
| 5. Signature features | Playwright spec exporter and suite runner | A passing trace exports a test; suite prints expected vs actual verdicts |
| 6. Submission | README, actual results, limitations, screenshots and recording | Clean-clone setup and five-minute demonstration complete |

## Validation matrix

| Scenario | Suggested target | Expected verdict |
|---|---|---|
| Valid customer login and dashboard verification | PHPTravels Customer demo | PASS |
| Wrong password and visible error verification | PHPTravels Customer demo | PASS (the error is the expected behavior) |
| Login and products-page verification | SauceDemo | PASS |
| Registration page and form verification | A public site with a registration form | PASS |
| Deliberately missing heading | SauceDemo or another public test site | FAIL |
| Unreachable URL | Non-resolving test domain | ERROR |
| Test without any verification | Any simple page | ERROR |
| Very small step limit | Login flow with `--max-steps 2` | ERROR |
| Password redaction | Any test using `--data password=...` | No password in console, trace or HTML text |
| Exported test | Any passing run | Playwright spec runs without an LLM API key |

Record actual outcomes, including failures and errors. Do not claim a pass rate unless repeated runs were actually measured.

## Five-minute screen recording

| Time | Demonstration |
|---|---|
| 0:00–0:40 | Explain the architecture and the rule that the runner, not the AI, decides the verdict |
| 0:40–2:10 | Run a PHPTravels customer login in headed mode; show terminal decisions and open `report.html` |
| 2:10–3:10 | Run a different plain-English test on an unrelated website with no source-code changes |
| 3:10–4:00 | Demonstrate a real FAIL and a tool-level ERROR, and explain the difference |
| 4:00–5:00 | Show `generated.spec.ts` running without AI, then explain limitations |

## Final submission checklist

- [ ] Public GitHub repository with a clear README
- [ ] `.env`, `node_modules/` and `artifacts/` ignored by Git
- [ ] No API key or real account credential committed
- [ ] `src/` contains no PHPTravels/SauceDemo-specific selector or flow
- [ ] PHPTravels customer login actually tested
- [ ] Same tool tested on a second unrelated website
- [ ] At least one deliberate FAIL and one ERROR demonstrated
- [ ] Actual results recorded honestly in the README
- [ ] Sample HTML report and generated Playwright test included in `docs/`
- [ ] Approach and limitations documented
- [ ] Five-minute screen recording prepared
