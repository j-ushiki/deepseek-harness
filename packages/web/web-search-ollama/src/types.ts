/**
 * Wire types for Ollama's web-search API (`POST https://ollama.com/api/web_search`).
 * Types only — no runtime code. Ollama returns a flat `results[]`; each entry
 * carries a URL, an optional title, and optional page `content`.
 *
 * @module @deepseek-ai/dsh-web-search-ollama/types
 */

/** Request body sent to Ollama's search endpoint. */
export interface OllamaSearchRequest {
  query: string
  /** Ollama's result-count control; the seam still enforces the bound on return. */
  max_results: number
}

/** One entry of Ollama's flat `results[]`. */
export interface OllamaResult {
  title?: string | null
  url: string
  content?: string | null
}

/** Ollama's search response envelope. */
export interface OllamaSearchResponse {
  results?: OllamaResult[]
}

/** Ollama's error response envelope (best-effort; fields vary by failure). */
export interface OllamaError {
  error?: string
  message?: string
}
