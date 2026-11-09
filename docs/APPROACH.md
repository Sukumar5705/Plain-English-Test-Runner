# Approach and limitations

## Approach

The Plain-English Test Runner uses an observe–plan–execute–verify loop. It opens a supplied URL in Chromium, inspects visible interactive elements and assigns temporary numbered references. The LLM receives the user's goal, the latest observation, a short action history and the allowed test-data keys. It proposes exactly one structured action per turn.

Zod validates every model response against a closed action vocabulary. The executor resolves numbered references locally, substitutes `{{key}}` placeholders locally, and performs the action through Playwright. The page is observed again after each action so navigation and state changes are reflected in the next decision.

The LLM does not grade its own work. Playwright assertions determine whether expectations were met. The runner reports PASS when at least one assertion passed, no assertion failed and the agent finished normally; FAIL when an assertion failed; and ERROR when execution was inconclusive. Screenshots, a JSON trace and an HTML report provide evidence. Successful runs can be exported as a starting Playwright test.

## Limitations

- CAPTCHA, MFA and bot-protection solving are out of scope.
- The initial observer does not inspect iframe contents or shadow roots.
- Custom controls without useful semantic attributes may not be discoverable.
- Drag-and-drop, file uploads, canvas-heavy interfaces and visual regression are not supported.
- An LLM can misinterpret ambiguous instructions; the report exposes the selected assertions so a reviewer can inspect them.
- Model outputs are non-deterministic, even with temperature set to zero.
- The weak-evidence flag is a heuristic, not proof that an action caused the asserted state.
- A generated Playwright test is a starting point and may need locator or test-data adjustments.
- One passing execution is not a reliability measurement. Repeated runs are needed to estimate stability.

Credentials should be supplied through `--data` or `DATA_<KEY>` environment variables. Literal credentials included in the natural-language test sentence are sent to the configured LLM provider.
