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
}

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

  return {
    model,
    dimensions,
    async embed(texts) {
      if (texts.length === 0) return [];

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: texts, dimensions }),
      });

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
