import { test, expect } from "bun:test"
import { ProviderError } from "../../src/provider/error"
import { APICallError } from "ai"

function mockAPICallError(message: string, options?: Partial<APICallError>): APICallError {
  return {
    message,
    name: "APICallError",
    cause: undefined,
    statusCode: options?.statusCode,
    responseHeaders: options?.responseHeaders,
    responseBody: options?.responseBody,
    data: options?.data,
    isRetryable: options?.isRetryable ?? false,
    url: options?.url,
  } as APICallError
}

test("parseAPICallError - Anthropic context overflow", () => {
  const error = mockAPICallError("prompt is too long: 200000 tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "anthropic",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Amazon Bedrock context overflow", () => {
  const error = mockAPICallError("input is too long for requested model")
  const result = ProviderError.parseAPICallError({
    providerID: "amazon-bedrock",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - OpenAI context overflow", () => {
  const error = mockAPICallError("This request exceeds the context window of 128000 tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "openai",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Google Gemini context overflow", () => {
  const error = mockAPICallError("input token count of 150000 exceeds the maximum of 128000")
  const result = ProviderError.parseAPICallError({
    providerID: "google",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - xAI Grok context overflow", () => {
  const error = mockAPICallError("maximum prompt length is 131072 tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "xai",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Groq context overflow", () => {
  const error = mockAPICallError("Please reduce the length of the messages")
  const result = ProviderError.parseAPICallError({
    providerID: "groq",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - OpenRouter context overflow", () => {
  const error = mockAPICallError("maximum context length is 8192 tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "openrouter",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - GitHub Copilot context overflow", () => {
  const error = mockAPICallError("Request exceeds the limit of 4096 tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "github-copilot",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - llama.cpp context overflow", () => {
  const error = mockAPICallError("Request exceeds the available context size")
  const result = ProviderError.parseAPICallError({
    providerID: "llama-cpp",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - LM Studio context overflow", () => {
  const error = mockAPICallError("Prompt length greater than the context length")
  const result = ProviderError.parseAPICallError({
    providerID: "lmstudio",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - MiniMax context overflow", () => {
  const error = mockAPICallError("context window exceeds limit")
  const result = ProviderError.parseAPICallError({
    providerID: "minimax",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Moonshot context overflow", () => {
  const error = mockAPICallError("Request exceeded model token limit")
  const result = ProviderError.parseAPICallError({
    providerID: "moonshot",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Generic context_length_exceeded", () => {
  const error = mockAPICallError("context_length_exceeded: too many tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "generic",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Cerebras 400 no body", () => {
  const error = mockAPICallError("400 (no body)")
  const result = ProviderError.parseAPICallError({
    providerID: "cerebras",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Mistral 413 no body", () => {
  const error = mockAPICallError("413 status code (no body)")
  const result = ProviderError.parseAPICallError({
    providerID: "mistral",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Non-overflow error", () => {
  const error = mockAPICallError("Invalid API key", { statusCode: 401 })
  const result = ProviderError.parseAPICallError({
    providerID: "anthropic",
    error,
  })
  expect(result.type).toBe("api_error")
  expect(result.message).toBe("Invalid API key")
})

test("parseStreamError - context_length_exceeded", () => {
  const streamError = {
    type: "error",
    error: { code: "context_length_exceeded" },
  }
  const result = ProviderError.parseStreamError(streamError)
  expect(result).toBeDefined()
  expect(result?.type).toBe("context_overflow")
})

test("parseStreamError - insufficient_quota", () => {
  const streamError = {
    type: "error",
    error: { code: "insufficient_quota" },
  }
  const result = ProviderError.parseStreamError(streamError)
  expect(result).toBeDefined()
  expect(result?.type).toBe("api_error")
})

test("parseStreamError - non-error returns undefined", () => {
  const streamError = { type: "success", data: "some data" }
  const result = ProviderError.parseStreamError(streamError)
  expect(result).toBeUndefined()
})

test("parseAPICallError - Multiple overflow keywords", () => {
  const error = mockAPICallError("context_length_exceeded: This model's maximum context length is 8192 tokens")
  const result = ProviderError.parseAPICallError({
    providerID: "generic",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Case insensitive matching", () => {
  const error = mockAPICallError("CONTEXT_LENGTH_EXCEEDED")
  const result = ProviderError.parseAPICallError({
    providerID: "generic",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - 413 Mistral variant", () => {
  const error = mockAPICallError("413 (no body)")
  const result = ProviderError.parseAPICallError({
    providerID: "mistral",
    error,
  })
  expect(result.type).toBe("context_overflow")
})

test("parseAPICallError - Empty message returns generic error", () => {
  const error = mockAPICallError("")
  const result = ProviderError.parseAPICallError({
    providerID: "generic",
    error,
  })
  expect(result.type).toBe("api_error")
})

test("parseStreamError - Handles undefined error code", () => {
  const streamError = {
    type: "error",
    error: {},
  }
  const result = ProviderError.parseStreamError(streamError)
  expect(result).toBeUndefined()
})

test("parseStreamError - Handles null input", () => {
  const result = ProviderError.parseStreamError(null as any)
  expect(result).toBeUndefined()
})

test("parseStreamError - Handles undefined input", () => {
  const result = ProviderError.parseStreamError(undefined as any)
  expect(result).toBeUndefined()
})
