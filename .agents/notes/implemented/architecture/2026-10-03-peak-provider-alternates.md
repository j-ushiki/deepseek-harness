# Agent Note: Peak provider alternates for one model entry

Status: implemented

English | [中文](2026-10-03-peak-provider-alternates.zh.md)

## Problem

A deployment that reaches the same model through two providers wants one provider during its normal hours and another peak — Ollama Cloud by day and OpenCode Go overnight, for example — with the same model id and reasoning effort. Neither existing owner expresses that.

- **Provider selection is per request, but configuration is static.** `dsh-llm` chooses the adapter by `LlmCallConfig.provider`, and `dsh-llm-pi-ai` materializes each route's `baseURL` and `api` when it resolves a model; only `apiKeyEnv` resolves per request. A model entry therefore cannot name two endpoints.
- **Routing at the agent loop changes the route identity.** An `agent/request` listener can rewrite `provider`, but the Session log, the model picker, and the model-selection switch notice all follow the rewritten provider: the picker flips to the alternate's group, and `installModelSelection` appends its "model changed" notice on every step of the peak window, because the assembled selection never matches the logged header.

## Decision

`dsh-llm-pi-ai` model entries take an optional `peak` list of local wall-clock windows. Each window names candidate providers resolved from pi-ai's **installed catalog**, in priority order, with an optional `apiKeyEnv`.

The adapter resolves the effective route once per request, in `prepareCall()` and `stream()`, before the credential await. Inside a matching window it dispatches the candidate's catalog descriptor; otherwise the route's own. The reported provider, model id, and Session log stay the configured route's, so the switch is invisible above the adapter: the picker keeps one provider group, no model-selection notice appears, and replay state survives because both routes are served by the same adapter instance.

A window is an inclusive `from` and an exclusive `to` `HH:mm`, read in its own IANA `timeZone`; a `to` earlier than `from` crosses midnight. Windows match in configuration order, so a later entry may carry a narrower interval.

### Candidates are catalog data, not other routes

A candidate must be an installed pi-ai provider that the catalog says serves the model; configuration refuses a bundled route, a hand-declared route, and a model the candidate does not describe. The adapter registers a catalog provider for each referenced candidate into its snapshot and builds a default execution profile for it, so a deployment does not also have to declare the alternate as a selectable route. The credential comes from the window's `apiKeyEnv`, resolved per request as a route's own is.

The catalog carries each window's serving provider through `LlmModelInfo.routing`, so the Web model selector names that provider and marks it automatic while the window is active.

## Alternatives considered

- **An `agent/request` listener** — rejected because it changes the route identity in the Session log, triggers the model-selection switch notice on every step, and shows the alternate's provider group in the picker.
- **A new logical route with its own adapter** — rejected because it duplicates protocol handling the catalog provider already owns.
- **A local forwarding proxy** — rejected because Ollama Cloud speaks `openai-responses` while OpenCode Go speaks `openai-completions`, so the proxy would translate protocols and add a process to supervise.
- **Naming another configured route as the alternate** — workable, but a candidate resolved from the catalog keeps the picker from gaining a second group for the same model.

## Consequences

- The Session log records the configured route, not the backend that physically served the request; that detail lives in the provider's own usage records.
- Capacities and reasoning levels follow the candidate's catalog descriptor, so a window whose candidate differs in capacity changes `request/context` at each switch.
- Cross-provider fallback on failure is deliberately absent: a failed request does not retry on another window candidate.
- The retry policy captured at registration belongs to the configured route, not to the candidate.
