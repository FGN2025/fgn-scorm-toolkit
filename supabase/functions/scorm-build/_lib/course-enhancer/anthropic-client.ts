/**
 * Thin wrapper around the official @anthropic-ai/sdk client.
 *
 * Centralizes:
 *   - default model selection (claude-opus-4-7)
 *   - adaptive thinking (the only on-mode for Opus 4.7)
 *   - prompt caching breakpoints on stable system prompts
 *   - streaming with .finalMessage() so we never hit request timeouts
 *     on long enhancements
 *   - structured-output via the Messages API output_config
 *
 * Callers (the prompt-template modules) hand us a system prompt + user
 * message and (optionally) a JSON schema for structured output. They
 * never touch the SDK directly, so future model bumps or beta header
 * additions are a one-line change here.
 *
 * Per the claude-api skill defaults: claude-opus-4-7 with adaptive
 * thinking is the right tool for this style of generation work
 * (rewriting + structured generation).
 */

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.40.0';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface EnhanceClientOptions {
  /**
   * Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. The
   * SDK reads it automatically; we accept it explicitly so callers
   * (e.g. an edge function or a test harness) can pass it in.
   */
  apiKey?: string;
  /**
   * Model id. Defaults to `claude-opus-4-7` per the FGN house default.
   * Override only if you have a specific reason — e.g. running the
   * enhancer pass on Sonnet to triage cost during a bulk re-enhance.
   */
  model?: string;
  /**
   * Effort level. Defaults to undefined (= API default of "high").
   * Use 'xhigh' on Opus 4.7 for the best cost/quality tradeoff in
   * production, 'low' for subagents or smoke tests.
   */
  effort?: EffortLevel;
  /**
   * Per-request timeout in ms. The SDK retries internally; this is
   * the wall-clock cap. Defaults to 5 minutes — enhancement is not
   * latency-sensitive (it runs at export time, not in the player).
   */
  requestTimeoutMs?: number;
}

export const DEFAULT_MODEL = 'claude-opus-4-7';
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_TOKENS = 16_000;

export interface SystemBlock {
  text: string;
  /**
   * If true, places a cache_control breakpoint after this block.
   * Use on the LAST block whose content is stable across calls in a
   * batch — anything after the breakpoint is volatile per-call content
   * and won't share cache hits.
   */
  cache?: boolean;
}

export class EnhanceClient {
  private readonly client: Anthropic;
  readonly model: string;
  readonly effort: EffortLevel | undefined;

  constructor(opts: EnhanceClientOptions = {}) {
    this.client = new Anthropic({
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      timeout: opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort;
  }

  /**
   * Stream a response and return the final assembled text. Streaming
   * matters here because briefing rewrites and quiz generations
   * regularly produce multi-thousand-token outputs; non-streaming
   * requests can hit transport timeouts.
   *
   * `systemBlocks` lets the caller place stable, expensive content
   * (style guide, framework reference) before volatile per-call content
   * with a cache_control breakpoint between them — the prompt cache
   * payoff across an N-challenge bundle is significant.
   */
  async generateText(args: {
    systemBlocks: SystemBlock[];
    userMessage: string;
    maxTokens?: number;
  }): Promise<string> {
    // We cast the full params bag because output_config / adaptive
    // thinking may not yet be reflected in the published SDK type
    // depending on the @anthropic-ai/sdk version pinned in deps.
    // Runtime behavior is what matters; the API endpoint accepts these.
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: args.systemBlocks.map(toAnthropicSystemBlock),
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: args.userMessage }],
    };
    if (this.effort) {
      params.output_config = { effort: this.effort };
    }
    // Cast through unknown — the exact published type for stream()
    // varies across SDK minors (MessageStreamParams vs.
    // MessageCreateParamsStreaming). Runtime shape is what the API
    // accepts; this avoids pinning to one minor.
    const stream = this.client.messages.stream(params as never);

    const final = await stream.finalMessage();
    return extractText(final);
  }

  /**
   * Generate a structured response validated against a JSON schema.
   * Uses output_config.format=json_schema so Claude's output is
   * constrained at decode time rather than relying on prompt
   * adherence. Caller passes a validator to confirm the runtime
   * shape after parsing.
   */
  async generateStructured<T>(args: {
    systemBlocks: SystemBlock[];
    userMessage: string;
    schema: Record<string, unknown>;
    schemaName: string;
    validate: (raw: unknown) => T;
    maxTokens?: number;
  }): Promise<T> {
    // We use the streaming variant for parity with generateText —
    // structured generations can be just as long as freeform text
    // when there are many quiz items.
    const outputConfig: Record<string, unknown> = {
      format: {
        type: 'json_schema',
        name: args.schemaName,
        schema: args.schema,
      },
    };
    if (this.effort) outputConfig.effort = this.effort;
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: args.systemBlocks.map(toAnthropicSystemBlock),
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: args.userMessage }],
      output_config: outputConfig,
    };
    // Cast through unknown — the exact published type for stream()
    // varies across SDK minors (MessageStreamParams vs.
    // MessageCreateParamsStreaming). Runtime shape is what the API
    // accepts; this avoids pinning to one minor.
    const stream = this.client.messages.stream(params as never);

    const final = await stream.finalMessage();
    const raw = extractJsonFromContent(final);
    return args.validate(raw);
  }
}

function toAnthropicSystemBlock(b: SystemBlock): Anthropic.TextBlockParam {
  // cache_control is part of the API but may not be reflected on
  // every released TextBlockParam type — cast defensively so we work
  // across SDK versions without pinning to a specific minor.
  const block: Record<string, unknown> = {
    type: 'text',
    text: b.text,
  };
  if (b.cache) block.cache_control = { type: 'ephemeral' };
  return block as unknown as Anthropic.TextBlockParam;
}

function extractText(msg: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('').trim();
}

function extractJsonFromContent(msg: Anthropic.Message): unknown {
  // First, look for the SDK's output_parsed shortcut on the response
  // (newer SDKs surface this when output_config.format is set).
  const parsed = (msg as unknown as { output_parsed?: unknown }).output_parsed;
  if (parsed !== undefined) return parsed;

  // Fallback: scan content blocks for the first text block that parses
  // as JSON, or a tool_use input. Covers older SDK shapes.
  for (const block of msg.content) {
    if (block.type === 'text') {
      const trimmed = block.text.trim();
      try {
        return JSON.parse(trimmed);
      } catch {
        // not JSON, keep scanning
      }
    }
    if (block.type === 'tool_use') {
      return block.input;
    }
  }
  throw new Error('No structured output returned by Claude');
}
