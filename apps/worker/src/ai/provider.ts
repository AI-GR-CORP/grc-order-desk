import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type { z } from 'zod';
import { config, need } from '../config';
import type { UsageInfo } from './pricing';

export type Purpose = 'triage' | 'extract' | 'discovery' | 'classify';

export interface CallOptions<T> {
  purpose: Purpose;
  model: string;
  /** Stable instructions + knowledge profile. Cached by the API across calls. */
  system: string;
  /** Per-call content (the email / thread). */
  user: string;
  /** PDF attachments (PI, PO, test reports) the model should read, base64. */
  documents?: { title: string; base64: string }[];
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: string;
}

export interface CallResult<T> {
  data: T;
  usage: UsageInfo;
}

export interface BatchResultItem {
  customId: string;
  ok: boolean;
  text?: string;
  usage?: UsageInfo;
  error?: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly supportsBatch: boolean;
  call<T>(opts: CallOptions<T>): Promise<CallResult<T>>;
  batchCreate(requests: { customId: string; opts: CallOptions<unknown> }[]): Promise<string>;
  batchStatus(id: string): Promise<{ ended: boolean; processing: number; succeeded: number; errored: number }>;
  batchResults(id: string): AsyncIterable<BatchResultItem>;
}

export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly usage?: UsageInfo,
  ) {
    super(message);
    this.name = 'AiOutputError';
  }
}

type AnyClient = Anthropic | AnthropicBedrock;

function buildParams(opts: CallOptions<unknown>, modelId: string) {
  const format = zodOutputFormat(opts.schema as z.ZodType);
  const output_config: Record<string, unknown> = { format: { type: 'json_schema', schema: format.schema } };
  if (opts.effort) output_config.effort = opts.effort;
  return {
    model: modelId,
    max_tokens: opts.maxTokens,
    system: [{ type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }],
    messages: [
      {
        role: 'user' as const,
        content: opts.documents?.length
          ? [
              ...opts.documents.map((d) => ({
                type: 'document' as const,
                title: d.title.slice(0, 200),
                source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: d.base64 },
              })),
              { type: 'text' as const, text: opts.user },
            ]
          : opts.user,
      },
    ],
    output_config,
  };
}

function usageOf(model: string, u: Anthropic.Messages.Usage | undefined): UsageInfo {
  return {
    model,
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_read_tokens: u?.cache_read_input_tokens ?? 0,
    cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
  };
}

function textOf(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Parses + validates a structured-output response body. */
export function parseStructured<T>(text: string, schema: z.ZodType<T>, usage?: UsageInfo): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiOutputError(`Model returned non-JSON output: ${text.slice(0, 200)}`, usage);
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new AiOutputError(`Output failed validation: ${issues}`, usage);
  }
  return r.data;
}

class ClaudeProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private readonly client: AnyClient,
    readonly supportsBatch: boolean,
    private readonly mapModel: (m: string) => string = (m) => m,
  ) {}

  async call<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
    const params = buildParams(opts as CallOptions<unknown>, this.mapModel(opts.model));
    // Cast: Bedrock and first-party clients share the Messages API shape.
    const message = (await (this.client as Anthropic).messages.create(
      params as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
    )) as Anthropic.Messages.Message;
    const usage = usageOf(opts.model, message.usage);
    if (message.stop_reason === 'max_tokens') throw new AiOutputError('Output hit max_tokens', usage);
    if (message.stop_reason === 'refusal') throw new AiOutputError('Model declined this request', usage);
    return { data: parseStructured(textOf(message), opts.schema, usage), usage };
  }

  async batchCreate(requests: { customId: string; opts: CallOptions<unknown> }[]): Promise<string> {
    if (!this.supportsBatch) throw new Error(`${this.name} does not support batches`);
    const batch = await (this.client as Anthropic).messages.batches.create({
      requests: requests.map((r) => ({
        custom_id: r.customId,
        params: buildParams(r.opts, this.mapModel(r.opts.model)) as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      })),
    });
    return batch.id;
  }

  async batchStatus(id: string) {
    const b = await (this.client as Anthropic).messages.batches.retrieve(id);
    return {
      ended: b.processing_status === 'ended',
      processing: b.request_counts.processing,
      succeeded: b.request_counts.succeeded,
      errored: b.request_counts.errored + b.request_counts.expired + b.request_counts.canceled,
    };
  }

  async *batchResults(id: string): AsyncIterable<BatchResultItem> {
    const stream = await (this.client as Anthropic).messages.batches.results(id);
    for await (const item of stream) {
      if (item.result.type === 'succeeded') {
        const msg = item.result.message;
        yield { customId: item.custom_id, ok: true, text: textOf(msg), usage: usageOf(msg.model, msg.usage) };
      } else {
        const err = item.result.type === 'errored' ? JSON.stringify(item.result.error).slice(0, 300) : item.result.type;
        yield { customId: item.custom_id, ok: false, error: err };
      }
    }
  }
}

let provider: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (provider) return provider;
  const cfg = config();
  if (cfg.AI_PROVIDER === 'bedrock') {
    const map: Record<string, string> = cfg.BEDROCK_MODEL_MAP ? JSON.parse(cfg.BEDROCK_MODEL_MAP) : {};
    const client = new AnthropicBedrock({ awsRegion: need('AWS_REGION'), maxRetries: 4, timeout: 180_000 });
    provider = new ClaudeProvider('bedrock', client, false, (m) => map[m] ?? m);
  } else {
    const client = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY'), maxRetries: 4, timeout: 180_000 });
    provider = new ClaudeProvider('anthropic', client, true);
  }
  return provider;
}

/** For tests: inject a fake provider. */
export function setProvider(p: LlmProvider | null): void {
  provider = p;
}
