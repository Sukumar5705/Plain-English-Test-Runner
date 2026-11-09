# Plain-English Test Runner

An AI-assisted, website-independent browser test runner. Give it a URL and a test case in ordinary English. An LLM proposes one browser action at a time, Playwright executes that action, and the runner independently computes a **PASS**, **FAIL**, or **ERROR** verdict from real browser assertions.

The project intentionally uses a CLI and a self-contained HTML report rather than a web server. It is designed to be small enough to understand and demonstrate, while remaining useful on websites that were not hard-coded into the repository.

## How it works

```text
URL + plain-English test + test data
                 |
                 v
        Launch Chromium (agent.ts)
                 |
                 v
       Observe current page (observer.ts)
                 |
                 v
       Ask LLM for one action (llm.ts)
                 |
                 v
       Validate action with Zod (schema.ts)
                 |
                 v
       Execute with Playwright (executor.ts)
                 |
                 +------> capture screenshot + trace step
                 |
                 +------> observe the updated page and repeat
                 |
                 v
       Runner computes PASS / FAIL / ERROR
                 |
                 v
       trace.json + report.html + optional generated.spec.ts
```

**The AI plans; the runner judges.** The model never generates executable code and cannot declare a test passed. Only Playwright assertions can establish a PASS or FAIL. A tool problem such as an unreachable site or exhausted step limit is reported as ERROR rather than being misrepresented as an application failure.

## Features

- Accepts a website URL and a plain-English test instruction.
- Inspects visible interactive elements dynamically and assigns short-lived numbered references.
- Uses an OpenAI-compatible chat API; the model and endpoint are configurable.
- Requests one structured action per turn and validates it against a closed Zod schema.
- Supports navigation, click, fill, select, check, press, and visibility/URL assertions.
- Re-observes the page after every action so flows can adapt after navigation and form submission.
- Handles recoverable browser-action errors, action limits and repeated-action detection.
- Keeps supplied test data out of the LLM prompt by using `{{key}}` placeholders and local substitution.
- Redacts sensitive test-data values (passwords, tokens, email/user identifiers and similar keys) from console output, JSON traces and HTML reports.
- Saves screenshots, a machine-readable trace and a self-contained HTML report per run.
- Generates a starter Playwright test after a PASS.
- Runs a sequential JSON suite and compares actual verdicts with expected verdicts.

## Requirements

- Node.js 20 or newer
- npm
- Network access to the target website and your selected LLM endpoint
- Chromium installed through Playwright
- An API key and model name for an OpenAI-compatible chat completions endpoint

## Setup

```bash
git clone <your-repository-url>
cd plain-english-test-runner
npm install
npx playwright install chromium
```

Create a local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```env
LLM_API_KEY=your_api_key
LLM_MODEL=your_model_name
LLM_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0
LLM_JSON_MODE=json_object

DATA_EMAIL=customer@example.com
DATA_PASSWORD=replace-me
```

`LLM_BASE_URL` can point to another OpenAI-compatible endpoint. Set `LLM_JSON_MODE=off` if the provider does not support JSON response mode. Set `LLM_TEMPERATURE=none` if the provider rejects the temperature parameter.

## Run one test

```bash
npm start -- --url "https://example.com" --test "Verify that the homepage is displayed" --headed
```

The `--headed` flag shows Chromium while the test runs. Omit it for headless execution.

Example login test:

```bash
npm start -- \
  --url "https://your-customer-login-url" \
  --test "Log in as a customer and verify the customer dashboard is displayed" \
  --data email=customer@example.com \
  --data password=your-password \
  --headed
```

PowerShell accepts the same command on one line or with its backtick line-continuation character.

Test data can be supplied through repeatable `--data key=value` arguments or environment variables named `DATA_<KEY>`. CLI values override matching environment values. In the prompt, the AI sees the allowed keys (for example `email`, `password`) rather than their actual values. Use `{{email}}` and `{{password}}` placeholders when the test needs those values. The executor substitutes them locally.

**Privacy note:** credentials typed literally inside the plain-English test sentence are part of the prompt sent to the LLM provider. Use `--data` or `.env` for credentials you do not want sent in the prompt. Sensitive values supplied through the data store are redacted from logs and saved text artifacts. Screenshots are visual evidence and should still be reviewed before sharing.

## CLI options

| Option | Purpose | Default |
|---|---|---|
| `--url` | Starting website URL | Required for a single run |
| `--test` | Plain-English test case | Required for a single run |
| `--data key=value` | Test data; can be repeated | None |
| `--headed` | Show the Chromium window | Headless |
| `--max-steps` | Maximum agent decisions | `25` |
| `--out` | Artifact output directory | `artifacts` |
| `--allow-origin` | Additional origin permitted for an AI-requested `navigate` action; repeatable | Start origin only |
| `--help` | Show CLI help | — |

Example with a second allowed origin:

```bash
npm start -- --url https://example.com --test "Open the help page and verify the support heading" --allow-origin https://support.example.com
```

The origin policy applies to AI-issued `navigate` actions. Normal links and form submissions can redirect to another origin because legitimate user journeys may include redirects.

## Run the example suite

```bash
npm run suite
```

Or choose a suite file and show the browser:

```bash
npm run suite -- examples/suite.json --headed
```

The sample suite checks the SauceDemo landing page and includes a deliberate missing-heading assertion. The second case is expected to produce FAIL; the suite itself succeeds when the actual verdict matches the expected verdict.

## Development checks

```bash
npm run typecheck
npm run unit
# npm test is an alias for npm run unit
```

The observer unit test uses a local HTML fixture, so it does not need a third-party website. Chromium must have been installed using `npx playwright install chromium`.

## Output artifacts

Each run creates a unique directory under `artifacts/`:

```text
artifacts/
└── run-2026-11-09T15-30-00-000Z/
    ├── report.html
    ├── trace.json
    ├── generated.spec.ts       # only when verdict is PASS
    └── screenshots/
        ├── initial.png
        ├── step-01.png
        └── step-02.png
```

- `report.html` is self-contained: styles and screenshots are embedded, so it can be opened locally without a server.
- `trace.json` records the page observation used for each decision, the action/reason, target, timing, URL before/after, status and screenshot reference. Sensitive values are redacted.
- `generated.spec.ts` is written only after PASS. It is a starting point generated from observed role/name targets; review it before using it in CI.

## Verdict rules

| Verdict | Meaning |
|---|---|
| **PASS** | No assertion failed, at least one assertion passed, and the agent finished with `done`. |
| **FAIL** | At least one Playwright assertion failed after its retry timeout. |
| **ERROR** | The result is inconclusive: site unreachable, LLM unavailable, invalid actions twice, agent blocked, step limit reached, stuck execution, three consecutive browser-action errors, or no successful assertion. |

A failed assertion takes precedence over tool errors. Exit codes are `0` for PASS, `1` for FAIL and `2` for ERROR. For a suite, exit code `0` means every actual verdict matched its expected verdict.

A PASS may carry a **weak evidence** warning when the run changed page state but the text used by a successful visible-text assertion was already present in the initial observation. This does not automatically invalidate the result; it tells the reviewer to inspect the evidence.

## Architecture and design decisions

The source tree intentionally contains eight focused files:

| File | Responsibility |
|---|---|
| `cli.ts` | CLI parsing, configuration validation, environment/test-data loading and suite dispatch |
| `agent.ts` | Browser lifecycle, observe/plan/execute loop, recovery/stuck detection and pure verdict calculation |
| `llm.ts` | OpenAI-compatible API call, JSON parsing, Zod validation, one repair retry and one transient network retry |
| `prompt.ts` | System prompt and compact per-step context builder |
| `schema.ts` | Shared Zod schemas and TypeScript contracts |
| `observer.ts` | Dynamic page inspection and numbered element references |
| `executor.ts` | Safe action execution, local placeholder substitution, assertions and redaction helper |
| `report.ts` | Console step logs, trace, self-contained HTML, test export and suite summary |

Dependency direction is kept simple: `cli → agent → (llm, observer, executor, report)`, and shared contracts live in `schema.ts`. The observer and executor do not depend on the LLM; the LLM does not import Playwright.

The action vocabulary is closed. There is no `eval`, generated JavaScript execution, or arbitrary shell/file-system action. Page content is treated as untrusted input in the prompt.

## PHPTravels validation

1. Open the official PHPTravels demo page: <https://phptravels.com/demo>.
2. Follow the current demo-access instructions and obtain the Customer login URL and credentials.
3. Keep credentials in `.env` or supply them with `--data`; do not commit them.
4. Run a customer login test and verify a piece of content that appears only after successful login (for example, a welcome message or dashboard heading observed on the live page).
5. Save and inspect the generated `report.html`.

Do not rely on old demo credentials copied from tutorials. The current demo access process and account availability should be checked when running the acceptance test.

## Approach and limitations

**Approach:** the application uses an observe–plan–execute–verify loop. The observer assigns numbered references to visible controls. The LLM chooses one action using only the current observation; Zod validates that action; Playwright executes it. The runner computes the verdict from assertions, not from the model's opinion. Every run produces evidence in an HTML report and JSON trace.

**Limitations:** CAPTCHA, MFA and bot-protection solving are out of scope. The first version does not inspect iframe contents or shadow roots, and may miss custom controls with no useful semantic attributes. Drag-and-drop, file uploads, canvas-heavy interfaces and visual regression are not supported. Ambiguous instructions and non-deterministic model responses can lead to different actions between runs. The weak-evidence check is a warning, not a formal proof of causal state change. The exported test is a useful starting point and may need locator or data adjustments. A single successful run is not a measured reliability guarantee.

## Repository structure

```text
plain-english-test-runner/
├── src/
│   ├── cli.ts
│   ├── agent.ts
│   ├── llm.ts
│   ├── prompt.ts
│   ├── schema.ts
│   ├── observer.ts
│   ├── executor.ts
│   └── report.ts
├── tests/
│   ├── fixtures/login.html
│   ├── schema.test.ts
│   ├── verdict.test.ts
│   ├── redact.test.ts
│   └── observer.test.ts
├── examples/suite.json
├── docs/
│   ├── SPEC.md
│   ├── APPROACH.md
│   ├── ARCHITECTURE.md
│   ├── sample-report.html
│   ├── sample-generated.spec.ts
│   └── SUBMISSION_CHECKLIST.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```
