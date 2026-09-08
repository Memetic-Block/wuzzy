/**
 * OpenAI-compatible embeddings client. Any endpoint speaking that shape works,
 * so a local model and a hosted one are the same code path.
 */
export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {}

/** Matches the vector(1536) column in the schema. */
export const DEFAULT_DIMENSIONS = 1536;
export const DEFAULT_MODEL = 'text-embedding-3-small';

export interface OpenAiEmbedderOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly dimensions?: number;
  /**
   * How many times to retry a rate limit or a provider-side error. The embed
   * pass makes roughly one request per document and runs them in order, so a
   * large crawl is a long sequence against a per-minute quota. Without this a
   * single 429 throws, which fails the crawl job that owns the embed step, and
   * the whole paid crawl is retried from the queue.
   */
  readonly maxRetries?: number;
  /** Injectable for tests, so a retry path does not sleep in the suite. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Rate limits and provider-side faults are worth another try; 4xx is not. */
const isRetryable = (status: number): boolean => status === 429 || status >= 500;

const RETRY_BASE_MS = 500;

/**
 * Injection token for a configured Embedder. Both the search service and the
 * crawl worker resolve one, so it lives beside the interface rather than in
 * whichever consumer happened to need it first.
 */
export const EMBEDDER = Symbol('EMBEDDER');

export function createEmbedder(
  options: OpenAiEmbedderOptions = {},
  env: Record<string, string | undefined> = process.env,
): Embedder {
  const baseUrl = (options.baseUrl ?? env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  const apiKey = options.apiKey ?? env.EMBEDDING_API_KEY;
  const model = options.model ?? env.EMBEDDING_MODEL ?? DEFAULT_MODEL;
  const dimensions = options.dimensions ?? Number(env.EMBEDDING_DIMENSIONS ?? DEFAULT_DIMENSIONS);
  const maxRetries = options.maxRetries ?? Number(env.EMBEDDING_MAX_RETRIES ?? 4);
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    model,
    dimensions,
    async embed(texts) {
      if (texts.length === 0) return [];

      let response!: Response;
      for (let attempt = 0; ; attempt += 1) {
        response = await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model, input: texts, dimensions }),
        });

        if (response.ok || attempt >= maxRetries || !isRetryable(response.status)) break;

        // Honour Retry-After when the provider sends one, since it knows when
        // the quota resets and exponential backoff is only a guess at it.
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : RETRY_BASE_MS * 2 ** attempt;
        await sleep(delay);
      }

      if (!response.ok) {
        throw new EmbeddingError(
          `embedding request failed: ${response.status} ${await response.text()}`,
        );
      }

      const payload = (await response.json()) as {
        data?: { index: number; embedding: number[] }[];
      };
      if (!payload.data || payload.data.length !== texts.length) {
        throw new EmbeddingError(
          `expected ${texts.length} embeddings, got ${payload.data?.length ?? 0}`,
        );
      }

      // The API is documented to preserve order, but it also returns an index
      // on every item, and trusting that costs nothing.
      const ordered = [...payload.data].sort((a, b) => a.index - b.index);
      for (const item of ordered) {
        if (item.embedding.length !== dimensions) {
          throw new EmbeddingError(
            `model "${model}" returned ${item.embedding.length} dimensions, expected ${dimensions}`,
          );
        }
      }
      return ordered.map((item) => item.embedding);
    },
  };
}

/** pgvector's literal input format. */
export const toVectorLiteral = (values: readonly number[]): string => `[${values.join(',')}]`;
