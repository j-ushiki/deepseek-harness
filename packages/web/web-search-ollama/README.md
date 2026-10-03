---
description: "The Ollama Cloud-backed search provider for ctx.web: how deployments mount Ollama Cloud web search over POST /api/web_search with live endpoint and result-count settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-ollama

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-ollama`, the harness searches the web through Ollama Cloud's `POST /api/web_search` using an `OLLAMA_CLOUD_API_KEY`. Choose it when a deployment holds an Ollama Cloud API key and wants Ollama Cloud's search results without a full model turn. Ollama Cloud returns no generated answer, so results carry no `content` — only citeable sources. An entry without a URL is dropped, so a call can return fewer sources than requested. The endpoint and result count are live settings the Web search page edits. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `ollama-cloud` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: ollama-cloud`.

### When to choose it

Choose this backend when a deployment holds an Ollama API key and wants a dedicated search endpoint rather than a model-mediated search. The provider is unavailable when the endpoint base does not parse or the result count is not a positive integer; a missing key fails the first search with a structured `WEB_PROVIDER_CREDENTIAL_MISSING` error.

### Minimal configuration

Load the web service and the provider; the key resolves from `ctx.credentials` when that service is mounted, otherwise from `$OLLAMA_CLOUD_API_KEY` in the launching environment. The endpoint reads `$OLLAMA_SEARCH_BASE_URL` over the default `https://ollama.com`, appending `/api/web_search` unless the value already names the full endpoint.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-ollama'
  config:
    apiKeyEnv: OLLAMA_CLOUD_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Ollama API key; prefer `apiKeyEnv` so no secret enters configuration. A non-empty literal wins over `apiKeyEnv` |
| `apiKeyEnv` | `OLLAMA_CLOUD_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the process environment when that service is absent. A search that needs a key and finds none fails as `WEB_PROVIDER_CREDENTIAL_MISSING` |
| `baseURL` | `https://ollama.com` | Ollama endpoint base, or the full `/api/web_search` endpoint; the path is appended when absent. Falls back to `$OLLAMA_SEARCH_BASE_URL`; an unparseable value makes the provider unavailable |
| `maxResults` | `5` | Positive-integer default result count when a request carries no `maxResults` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-ollama) is the exhaustive source for every accepted field and its JSDoc. Every field is live: the Web search settings page writes them through the plugin entry, and each search captures the current values.

### What a search returns

Each Ollama result maps to a `WebSearchSource`: `url`, an optional `title`, and the entry's trimmed `content` as `snippet`; an entry with no URL has nothing to cite and is dropped. A request's `maxResults` wins over the configured default and is sent to Ollama as `max_results` as a cost and latency optimization — the final bound is enforced by the service, which truncates and flags. Ollama returns no generated answer, so the result carries no `content`.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; a missing credential is `WEB_PROVIDER_CREDENTIAL_MISSING`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Every failure after dispatch names the resolved endpoint and explains that search endpoint configuration is separate from chat; the message points at the Endpoint field under Settings > Plugins > Plugin configuration > Web search and, when that page is unavailable, at `OLLAMA_SEARCH_BASE_URL` and `web-search-ollama.baseURL`. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over Ollama's search endpoint with two deliberate rules:

- **Citeable sources only.** An entry without a URL is dropped rather than cited by an invented one, and a `snippet` comes only from the entry's own `content`.
- **No invented answers.** Ollama returns no generated answer, so `content` is omitted rather than fabricating provider prose the model might trust.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: live config schema, environment fallback, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `OllamaSearchProvider`: request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | Ollama wire types: `OllamaSearchResponse`, `OllamaResult`, `OllamaError` |

### Request flow

`search()` posts the query and result count to `{baseURL}/api/web_search` with a bearer key and `redirect: 'error'`, so a redirect fails the request without contacting the target. The parsed `results[]` are mapped one by one, URL-less entries dropped, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the web package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-ollama) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, and page excerpts or its exact `Ollama Cloud search aborted`, `Ollama Cloud search request failed: <error>`, and `Ollama Cloud returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **An entry with no URL is dropped entirely** — there is no citeable source to map, so fewer sources than requested can return.
- **Only the endpoint and result count are exposed** — Ollama Cloud's other search controls wait on provider-neutral service fields.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: wider Ollama control surface

Ollama Cloud's other request controls stay unexposed. Exposing them needs provider-neutral service fields first, so the family adds one coordinated control rather than a vendor-specific argument.

</details>
