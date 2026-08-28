---
name: stripe-projects-cli
description: Use the Stripe Projects CLI in this repository to manage deploying and access to third party services.
---

# Stripe Projects CLI

This repository is initialized for the Stripe project "Set Business Consults (USA Ops)".

# Workflow
0. Use the repository-local CLI as `npx stripe`; the system `stripe` executable is not available in this checkout. Fetch provider guidance only when it is relevant with `npx stripe projects llm-context --provider <provider> --fetch`. Generated guidance is reference material, not authorization for provider writes.
1. Start with `npx stripe projects status --json` or another documented read-only JSON command to inspect the current project, linked providers, and named resources.
2. Use `npx stripe projects catalog --json` or `npx stripe projects services list --json` to browse available providers and services. When you know the provider, run `npx stripe projects catalog <provider> --json` and copy the exact `<provider>/<service>` slug from the output.
3. Provision a resource only when the user has authorized that provider/service and any paid or terms-bearing commitment. Do not guess the argument. Run `npx stripe projects catalog <provider> --json` and copy the exact `<provider>/<service>` slug before `npx stripe projects add <provider>/<service>`. Example: `npx stripe projects add databaseco/postgres --name primary-db`. Use `--name <resource>` to control the local resource name used by future resource commands and environment variable prefixes. If you omit `--name`, the CLI uses the provider/service default for the local resource name. Use `--config '<json>'` when the service requires configuration.
4. Review credential names with redacted `npx stripe projects env --json`. Use `npx stripe projects env --pull` only when the requested implementation or deployment actually requires updating the CLI-managed output file. Never print credential values.
5. After a successful `npx stripe projects add`, summarize the result and suggest next steps:

   | Field | Value |
   |-------|-------|
   | Provider | `<provider name>` |
   | Service | `<service type>` |
   | Tier | `<tier>` |
   | Env vars | `<variable names only — never values>` |

   Then show a compact summary of the other services already provisioned on the project (from `npx stripe projects status --json`):

   **Already on this project:**

   | Provider | Service | Env var prefix |
   |----------|---------|----------------|
   | ProviderA | service-name (Tier) | `PREFIX_*` |
   | ProviderB | service-name (Tier) | `PREFIX_*` |

   Then suggest 3–5 complementary services from different categories in the catalog (e.g., if user added a database, suggest auth, hosting, or observability). Only reference services that actually appear in `npx stripe projects catalog --json` output — never fabricate commands or provider names. Use this human-friendly format without CLI commands or provider/service slugs:

   1. ProviderName (category) — short description of what it provides
6. For named environments, use `npx stripe projects env list` to see all environments and the active `*`, `npx stripe projects env create <environment> --output .env.<environment>` to create one, and `npx stripe projects env use <environment>` to switch the active environment.
7. Use `npx stripe projects env add <resource>` and `npx stripe projects env remove <resource>` to change resource membership for the active environment only. Use `npx stripe projects env add <variable> --variable --env-key <KEY>` and `npx stripe projects env remove <variable> --variable` to change project variable membership for the active environment only.

## Optional notes
* If necessary, link a provider with `npx stripe projects link <provider>` after the user authorizes that provider link and any required terms/data sharing. `npx stripe projects add <provider>/<service>` may also guide provider authentication, but must not be used as a fallback that silently provisions a new account when the user selected an existing-resource route.

# Working Agreement
- Commands can be run from the project root or nested directories inside the project.
- Do not hand-edit CLI-managed files under `.projects` or the generated `.env` output.
- NEVER look at any files in the .projects directory. The CLI manages everything for you.
- NEVER look at `.env`. The CLI manages everything for you.
- If `STRIPE_API_KEY` overrides the Projects session and causes `NOT_AUTHENTICATED` or an invalid-key error, remove only that process variable and retry from the repository's `scripts` directory in the same PowerShell process. Do not inspect or edit `.env` to work around it.

# Agent mode
- You can use the `--json` flag when structured output will make follow-up steps easier.
- When you need to build a provisioning command programmatically, prefer `npx stripe projects catalog <provider> --json` so you can copy the exact `<provider>/<service>` slug without guessing.
- Use `--non-interactive` to disable prompts across commands. When you do, pass fully specified arguments and companion flags like `--yes` when the command requires confirmation.

## Headless limitations
You CANNOT complete browser authentication alone. If a command exits with `BROWSER_AUTH_REQUIRED`, run `npx stripe login --non-interactive --new-session` to print JSON with `browser_url`, `verification_code`, and `next_step`; present `browser_url` and `verification_code` to the user, then run the emitted `next_step` command to complete login before retrying. `--new-session` is required: without it the Stripe CLI prints "already logged in" and exits 0 without authenticating, and that exit 0 is not success. If the CLI rejects `--new-session` as an unknown flag (Stripe CLI older than 1.50.0), run the same command without that flag. If any login attempt prints "already logged in" instead of JSON, stop and tell the user to run `npx stripe projects init` themselves in a terminal with browser access. Never retry the original command until login has actually completed. Try login once only: if the same check still fails after a completed login, another sign-in will not change it. If a command exits with `PROJECTS_SESSION_UNUSABLE`, a person must run `npx stripe projects init` in a terminal with browser access; do not retry. If a command exits with `ACCOUNT_NOT_ELIGIBLE` or `MERCHANT_MISMATCH`, report it and ask the user to run `npx stripe projects switch-account` in a terminal with browser access. If a command exits with `INVALID_API_KEY`, remove or correct the process-level `STRIPE_API_KEY` or mode and retry; do not inspect `.env` or run Projects initialization for it.

An exit code of 0 from a login or account command does not by itself mean the blocker cleared. Re-read the output: if it says you are already logged in, or that a command needs an interactive terminal, the blocker is still there and the only way forward is a person.

## Error codes
When a command fails, the error output includes a machine-readable code in parentheses. React to these programmatically:

| Code | Meaning | What to do |
|------|---------|------------|
| `BROWSER_AUTH_REQUIRED` | No Stripe session and browser auth needed | Run `npx stripe login --non-interactive --new-session`, give the user `browser_url` and `verification_code`, then run the emitted `next_step`. If `--new-session` is rejected as unknown (Stripe CLI older than 1.50.0), drop it and run the command again. "already logged in" with no JSON is a stop, not a retry: hand the user `npx stripe projects init`, never another login attempt. Try it once: if the check still fails after a completed login, hand the user Projects initialization and stop |
| `PROJECTS_SESSION_UNUSABLE` | Stripe CLI session exists but Projects cannot read live-mode credentials from it | Report the message to the user and stop. Do NOT retry |
| `BROWSER_AUTH_TIMEOUT` | Browser auth did not complete in time | Ask the user to finish the browser flow, then retry |
| `ACCOUNT_NOT_ELIGIBLE` | Account not onboarded for Projects | `npx stripe projects switch-account` needs an interactive terminal. Report this and ask the user to run it in a terminal with browser access. Do not retry |
| `INVALID_API_KEY` | STRIPE_API_KEY is set and unusable: a key for the other mode, or one that failed to authenticate | Follow the message: pass or drop `--test`, or unset/replace STRIPE_API_KEY, then retry |
| `TOS_ACCEPTANCE_REQUIRED` | Provider terms not accepted | Stop. Disclose the provider terms, privacy/data-sharing implications, and paid-service commitment if any; use `--accept-tos` only after explicit confirmation for this provider attempt |
| `PLAN_REQUIRED` | Service needs a plan provisioned first | Inspect the exact plan, pricing, dependencies, and whether it creates a new provider account. Provision it only after the user authorizes that plan; then retry the child service |
| `PROVIDER_NOT_LINKED` | Provider requires OAuth linking | Run `npx stripe projects link <provider>` only after link authorization and any required terms disclosure; browser completion may be needed |
| `JSON_REQUIRES_CONFIRMATION` | Interactive confirmation needed | If the underlying write is already authorized, re-run with `--yes`; otherwise obtain authorization first |
| `MERCHANT_MISMATCH` | Logged-in account differs from project owner | Ask the user to run `npx stripe projects switch-account` in a terminal with browser access. Do not retry the original command |

# Full command reference
- `npx stripe projects status --json` — view project, providers, and services
- `npx stripe projects catalog [provider] --json` — browse available services and copy exact `provider/service` slugs
- `npx stripe projects add <provider>/<service>` — provision an authorized service
- `npx stripe projects add databaseco/postgres --name primary-db` — example add command you can adapt after authorization
    - `--name <resource>` — custom local resource name for future commands and env var prefixes
    - `--config '<json>'` — service configuration that can be passed with `projects add`
    - `--provider-config '<json>'` — provider link configuration (e.g. region)
    - `--force-provider-relink` — force a fresh provider link request during `add`
- `npx stripe projects add @database` — browse services by category (interactive only)
- `npx stripe projects remove <resource>` — remove a provisioned resource
- `npx stripe projects rotate <resource>` — rotate credentials for a resource
- `npx stripe projects upgrade <resource>` — change a resource's service tier
- `npx stripe projects open <provider>` — open provider dashboard in browser
- `npx stripe projects link <provider>` — link/re-link a provider
- `npx stripe projects link <provider> --force` — force a fresh provider re-link request
- `npx stripe projects env --json` — list credential names and redacted metadata
- `npx stripe projects env --pull` — fetch credentials into the CLI-managed output file
- `npx stripe projects env list` — list named project environments and mark the active one with `*`
- `npx stripe projects env show` — show the active project environment
- `npx stripe projects env create <environment> --output .env.<environment>` — create a named environment and make it active
- `npx stripe projects env use <environment>` — switch the active environment
- `npx stripe projects env add <resource>` — add an existing resource to the active environment
- `npx stripe projects env remove <resource>` — remove resource membership from the active environment
- `npx stripe projects variables set <name> --env-key <KEY> [--value <value>]` — store a backend-backed project variable and bind it to the active environment
- `npx stripe projects variables list` — list project variables and local environment bindings
- `npx stripe projects variables delete <name>` — delete a project variable and its local bindings
- `npx stripe projects env add <variable> --variable --env-key <KEY>` — bind an existing project variable to the active environment
- `npx stripe projects env remove <variable> --variable` — remove project variable membership from the active environment
- `npx stripe projects llm-context --provider <provider> --fetch` — fetch provider-specific guidance
- `npx stripe projects billing show` — view billing method
- `npx stripe projects billing add` — add or update billing method
- `npx stripe projects spend` — view charges on the account

# Companion plan services
Some deployable services require a companion **plan** service to be provisioned first (controls pricing tier/resource limits).

## Checking existing plans
Run `npx stripe projects status --json` to see provisioned plans. If the required plan is already active and the child deployment is authorized, no additional plan write is needed.

## Provisioning order
When adding a deployable that has component pricing and no plan is yet provisioned:
1. Identify the required plan via `npx stripe projects catalog <provider> --json` and inspect plan-kind parent services.
2. Present the exact plan, pricing/commitment, provider-account behavior, terms/data-sharing consequences, and child dependency for approval.
3. After explicit approval, provision the plan with the exact catalog slug and only the flags the user approved.
4. Provision the authorized deployable with the exact catalog slug. Do not carry `--accept-tos`, paid-service confirmation, or `--yes` into adjacent resources without matching authority.

The plan must be provisioned before the deployable. If the CLI returns `PLAN_REQUIRED`, treat the listed command as a proposal, not automatic authorization. Confirm plan identity, pricing, provider-account behavior, and user approval before running it.

# Billing
Use `npx stripe projects billing show` for read-only billing status. Run `npx stripe projects billing add` only when the user has authorized configuring or changing the billing method.

# Deployment
If you get asked to deploy your project, copy the following files to the remote host into the project root:
* .env
* .projects/state.json
* .projects/state.local.json

Deploying a project might require to provision a provider that offers compute or hosting, and you may need to download their CLI.

# Troubleshooting
- If a command fails, check the error code in the output (e.g. `(PLAN_REQUIRED)`) and consult the error codes table above.
- If a command fails unexpectedly, run `npx stripe projects status --json` to understand the current state.
- If a provider shows `PENDING_AUTH` or `EXPIRED`, propose `npx stripe projects link <provider>` and explain whether `--force` would create a fresh provider request. Re-link only with authority for that provider write.
- If credentials seem stale, diagnose with redacted metadata first. Run `npx stripe projects rotate <resource>` and `npx stripe projects env --pull` only after credential rotation is explicitly authorized.

<!-- stripe-projects-cli managed:7bd0541c6448 -->
