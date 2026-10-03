---
description: "The search-provider settings page on the dsh web client's Plugins page: choosing among the deployed search providers and editing the selected provider's key, endpoint, and per-request bound."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Web search** in the Official group to choose which search provider this deployment uses and to set that provider's key, endpoint, and per-request bound. The selector appears only when the deployment composes more than one search provider; choosing one writes `web.searchProvider` immediately, while the provider's own fields keep the page's stage-then-save behavior. The key is written through the credentials domain rather than the settings document, so its literal never rides a response. The page exists while the Host serves any search-provider namespace.

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

The **Web search** card in the Official group opens the page. When the deployment composes two or more search providers, a **Search provider** control lists exactly the providers the Host serves and writes the choice to `web.searchProvider`; the fields below it then belong to the chosen provider, and switching discards any unsaved edits so one provider's draft can never be saved into another's section. With a single provider the control is absent and the page looks as it always did.

**API key** starts blank on every load and reports only whether a key is configured; a blank draft keeps the stored key, and the control is disabled when the credential cannot be written from here, such as a key the process environment supplies. The reference it addresses is the selected provider's `apiKeyEnv` when the section names one, otherwise that provider's default — `DEEPSEEK_API_KEY` for DeepSeek, `OLLAMA_CLOUD_API_KEY` for Ollama Cloud. **Endpoint** and the provider's bound field (**Max searches per request** for DeepSeek, **Max results** for Ollama Cloud and Exa, **Max answer tokens** for Perplexity) render the effective value, with the endpoint showing the selected provider's default faintly while it is empty, carry an **Overridden** badge with **Reset to default** once overridden, and save as a reset when emptied. Nothing but the provider choice is written until **Save**; leaving the page drops the drafts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half keeps a `WebSearchCardController` over the shared `SettingsFormModel` of `ui-primitives`. The controller holds a table mapping each provider id to its namespace, bound field, and credential reference — duplicated from the Host packages because the client bundle purity gate forbids importing them — and derives the served subset from the settings describe mirror. A `SwitchableScope` forwards the form model's reads and writes to the selected provider's `ctx.configForms.get` result, so switching providers swaps the section without rebuilding the staged form; the controller discards staged edits before the swap. The key is the form's one secret control: its write goes to `remote.credentials.set` under the reference above, and success is read back from `remote.credentials.describe`. The controller re-reads the credential when the scope changes and when the Host reports `credentials/reference-updated` for the watched reference, since a key written on the Models page changes no settings section. The page registers `WebSearchCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed` over the provider namespaces.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [credentials](../../credentials/README.md) — the credential-reference seam the key writes through.
- [web-search-deepseek](../../web/web-search-deepseek/README.md) — the DeepSeek provider that registers its namespace.
- [web-search-ollama](../../web/web-search-ollama/README.md) — the Ollama Cloud provider that registers its namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The provider table is duplicated in the client** — a client bundle cannot import a Host package, so a new provider needs a matching entry here and a locale label.
- **Only each provider's endpoint and bound are exposed** — other provider-specific fields (model, API version, token budget, recency) stay at their composed values.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
