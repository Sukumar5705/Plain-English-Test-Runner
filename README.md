# Plain-English Test Runner

**Turn natural-language test instructions into observable, evidence-backed browser runs.**

Plain-English Test Runner is a command-line browser automation tool built with TypeScript and Playwright. It accepts a starting URL and a test written in ordinary English, then uses an LLM to choose browser actions one at a time. Playwright performs those actions and evaluates assertions. The runner—not the language model—determines whether the outcome is **PASS**, **FAIL**, or **ERROR**.

The project is intentionally website-independent: it discovers the currently visible page controls at runtime instead of relying on selectors or workflows hard-coded for one demo website.

---

## At a glance

| Area | Implementation |
|---|---|
| Runtime | Node.js 20+ and TypeScript |
| Browser automation | Playwright with Chromium |
| Action validation | Zod discriminated-union schema |
| LLM integration | OpenAI-compatible chat completions endpoint |
| Interface | Command-line runner |
| Evidence | Per-step screenshots, `trace.json`, self-contained `report.html` |
| Verdicts | Runner-computed `PASS`, `FAIL`, or `ERROR` |
| Reusable output | Playwright `generated.spec.ts` after a passing run |

## Core principles

1. **Observe before acting.** The runner inspects the current page before each LLM decision and supplies a compact description of visible controls and page content.
2. **One action per decision.** The model proposes one structured action, the runner validates it, and Playwright executes it. The page is then observed again.
3. **Constrained execution.** The model can select only from a fixed set of supported actions. Arbitrary model-generated JavaScript is not executed.
4. **Independent verdicts.** Playwright assertions determine test success or failure. Tooling and execution problems are reported as `ERROR`, not disguised as application failures.
5. **Evidence for review.** Each run records step details, timing, screenshots, assertions, and a final HTML report.

## Capabilities

- Run a natural-language test against a supplied website URL.
- Observe visible links, buttons, form controls, roles, labels, placeholders, headings, alerts, and a bounded page-text excerpt.
- Refer to observed controls using temporary numbered references.
- Support navigation, click, fill, select, check, key press, and visibility/URL assertions.
- Re-observe the page after actions so the next decision uses the updated browser state.
- Substitute `{{key}}` test-data placeholders locally, keeping the corresponding values out of the LLM prompt.
- Validate model output with Zod and reject unsupported action shapes.
- Detect execution limits and repeated browser-action failures.
- Redact supplied sensitive data values from text-based run artifacts.
- Produce a self-contained HTML report and machine-readable JSON trace for every run.
- Export a starting Playwright test after a successful run.
- Execute sequential JSON suites with expected-versus-actual verdict comparison.

## Architecture

The system is organized as a small CLI, an agent control loop, an observation layer, a constrained LLM planner, a Playwright executor, and an artifact/reporting layer.

See **[Architecture and Design](docs/ARCHITECTURE.md)** for the component diagram, execution sequence, trust boundaries, verdict logic, and module responsibilities.

## Requirements

- Node.js 20 or newer
- npm
- Network access to the target website and configured LLM endpoint
- An API key and model identifier for an OpenAI-compatible chat completions endpoint
- Chromium installed through Playwright

## Getting started

### 1. Install dependencies

```bash
git clone <your-repository-url>
cd plain-english-test-runner
npm install
npx playwright install chromium
```

### 2. Configure the LLM

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set the required values in `.env`:

```dotenv
LLM_API_KEY=your_api_key
LLM_MODEL=your_model_name
LLM_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0
LLM_JSON_MODE=json_object

# Optional test data; use placeholders in the test instruction.
DATA_EMAIL=your-test-account@example.com
DATA_PASSWORD=your-test-password
```

`LLM_BASE_URL` may be changed to another OpenAI-compatible endpoint. Set `LLM_JSON_MODE=off` if the selected provider does not support JSON response mode. Set `LLM_TEMPERATURE=none` if the provider does not accept a temperature parameter. Provider model names, request limits, and pricing are controlled by the provider and may change.

Do not commit `.env`. Keep credentials in environment variables or `--data` arguments rather than typing them directly into the natural-language prompt.

### 3. Run a test

General form:

```bash
npm start -- --url "https://example.com" --test "Verify that the homepage is displayed" --headed
```

Example using the QA Automation Labs demo store:

```powershell
$env:DATA_EMAIL = "your-test-email"
$env:DATA_PASSWORD = "your-test-password"

npm start -- --url="https://shop.qaautomationlabs.com/" --test="Log in using email {{email}} and password {{password}}, then verify that the store is successfully opened and the product catalog is displayed." --headed
```

Replace the example test-data values with credentials you are authorized to use. The `--headed` flag displays the Chromium window. Omit it to run headlessly.

Test data can also be supplied directly as repeatable arguments:

```bash
npm start -- \
  --url "https://example.com/login" \
  --test "Log in using {{email}} and {{password}}, then verify the dashboard is visible" \
  --data email=customer@example.com \
  --data password=replace-me
```

The LLM receives the available data keys (such as `email` and `password`), not the corresponding values. The executor replaces `{{email}}` and `{{password}}` locally when it fills a control. Values typed literally into the test instruction are part of the prompt and may be sent to the configured LLM provider.

## CLI reference

| Option | Description | Default |
|---|---|---|
| `--url <url>` | Starting page for a single run | Required |
| `--test <text>` | Natural-language test instruction | Required |
| `--data <key=value>` | Test data; repeat for multiple values | None |
| `--headed` | Show the Chromium browser | Headless |
| `--max-steps <number>` | Maximum number of agent decisions | `25` |
| `--out <directory>` | Root directory for run artifacts | `artifacts` |
| `--allow-origin <origin>` | Additional origin allowed for model-issued `navigate` actions; repeatable | Starting origin only |
| `--help` | Print CLI usage | — |

The origin allow-list applies to model-issued `navigate` actions. Normal page links and form submissions may redirect as part of the website's own flow.

## Supported actions

The LLM may return only the following action types. Every action includes a short explanation (`reason`), and its shape is validated before execution.

| Action | Purpose |
|---|---|
| `navigate` | Navigate to an allowed URL |
| `click` | Click an observed element reference |
| `fill` | Fill an observed field, including locally substituted `{{key}}` values |
| `select` | Choose a visible option from a select control |
| `check` | Check a checkbox or activate a supported check-like control |
| `press` | Press a keyboard key |
| `assertVisible` | Assert that matching text is visible |
| `assertNotVisible` | Assert that matching text is not visible |
| `assertUrl` | Assert that the current URL contains the requested text |
| `finish` | Report that the agent is done or blocked; it does not itself prove a test passed |

## Run the example suite

The repository includes `examples/suite.json`, a sequential suite with a positive SauceDemo page check and a deliberate missing-heading case.

```bash
npm run suite
```

To show the browser:

```bash
npm run suite -- examples/suite.json --headed
```

A suite is successful when each actual verdict matches its configured expected verdict. A case that is deliberately expected to `FAIL` can therefore be part of a successful suite run.

## Development checks

```bash
npm run typecheck
npm test
```

`npm test` runs the Node test suite (the `npm run unit` script). Tests cover action-schema validation, verdict logic, redaction and local placeholder substitution, and page observation using a local HTML fixture.

## Verdict model

| Verdict | Meaning | Typical examples |
|---|---|---|
| **PASS** | The agent completed the task, at least one Playwright assertion passed, and no assertion failed. | Expected text is visible; expected URL is reached. |
| **FAIL** | At least one Playwright assertion failed. | A required heading or message was not found. |
| **ERROR** | The run is inconclusive because the tool could not complete verification. | Site unreachable, LLM/configuration failure, blocked run, step limit reached, repeated browser-action failures, or no successful assertion. |

A failed assertion takes precedence over other fatal conditions. The exit codes are `0` for `PASS`, `1` for `FAIL`, and `2` for `ERROR`. In suite mode, exit code `0` means all cases matched their expected verdicts.

A passing run may include a weak-evidence warning if an asserted text phrase was already present in the initial page observation even though the run later changed page state. Review the report rather than treating the warning as proof of a false pass.

## Run artifacts

Each execution writes to a timestamped directory under `artifacts/`:

```text
artifacts/
└── run-<timestamp>/
    ├── report.html
    ├── trace.json
    ├── generated.spec.ts       # written only for PASS
    └── screenshots/
        ├── initial.png
        ├── step-01.png
        └── step-02.png
```

- **`report.html`** — self-contained report with verdict, goal, assertion details, step reasons, timings, observations, and embedded screenshots.
- **`trace.json`** — structured record of the run, including step/action details, page observations, timing, URLs, and assertion outcomes.
- **`screenshots/`** — initial and per-step browser captures where available.
- **`generated.spec.ts`** — Playwright test export created only after `PASS`. Treat it as a starting point: inspect and replay it before relying on it in a CI pipeline.

Open a report locally, for example:

```powershell
Start-Process .\artifacts\run-<timestamp>\report.html
```

See **[Recorded Test Results](docs/TEST_RESULTS.md)** for the observed demo-store runs and the validation gaps that remain.

## Security and data handling

- Keep API keys and test credentials out of source control. Use `.env` or `--data` and retain `.env.example` as the shareable template.
- Use placeholders such as `{{password}}`; their values are substituted in the executor rather than included in the LLM prompt.
- Supplied values associated with sensitive-looking keys (for example, password, secret, token, key, email, and user) are redacted from text-based console and artifact output.
- The observer does not include ordinary entered input values in its page summary.
- Browser screenshots are visual artifacts. Review them for personal or confidential information before sharing or committing them.
- Website content is untrusted input. The model's response is schema-validated, and the runner does not execute arbitrary LLM-generated code.

## Current scope and limitations

This project focuses on semantic browser interactions and basic text/URL assertions. It is not a full visual-testing or cross-browser platform.

- CAPTCHA, MFA challenges, and bot-protection bypass are out of scope.
- iframe and shadow-root contents are not inspected by the current observer.
- Drag-and-drop, file upload, canvas-heavy interfaces, and visual-regression comparison are not supported as first-class actions.
- Custom controls without useful semantic attributes may be difficult to identify reliably.
- LLM responses and external websites can vary between runs; one successful execution is not a reliability-rate measurement.
- The weak-evidence indicator is a heuristic warning, not formal proof that a state transition caused the asserted content.
- Generated Playwright code should be reviewed and replayed before it is adopted as a maintained regression test.

## Documentation

- [Architecture and Design](docs/ARCHITECTURE.md) — components, execution flow, trust boundaries, and verdict computation.
- [Recorded Test Results](docs/TEST_RESULTS.md) — actual execution matrix, run identifiers, and outstanding verification.
- [Product and Technical Specification](docs/SPEC.md) — requirements, action/data contracts, and acceptance criteria.
- [Implementation Approach](docs/APPROACH.md) — implementation choices and rationale.
- [Submission Checklist](docs/SUBMISSION_CHECKLIST.md) — final packaging and demonstration checklist.

## Repository layout

```text
plain-english-test-runner/
├── src/
│   ├── agent.ts             # observe–plan–execute loop and verdict calculation
│   ├── cli.ts               # command-line parsing and suite dispatch
│   ├── executor.ts          # allow-listed Playwright actions and assertions
│   ├── llm.ts               # provider request, parsing, validation and retry
│   ├── observer.ts          # runtime page inspection and numbered references
│   ├── prompt.ts            # planner instructions and context formatting
│   ├── report.ts            # console output and run artifacts
│   └── schema.ts            # Zod contracts and shared TypeScript types
├── tests/                   # unit tests and local HTML fixture
├── examples/
│   └── suite.json           # sample sequential test suite
├── docs/
│   ├── APPROACH.md
│   ├── ARCHITECTURE.md
│   ├── SPEC.md
│   ├── SUBMISSION_CHECKLIST.md
│   ├── TEST_RESULTS.md
│   ├── sample-generated.spec.ts
│   └── sample-report.html
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

**Project status:** The demo-store execution record is documented in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md). The record distinguishes successful assertions from expected failures and inconclusive runs; it does not claim that every acceptance scenario has passed.
