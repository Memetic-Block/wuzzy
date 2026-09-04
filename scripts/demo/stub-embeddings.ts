/**
 * A local OpenAI-compatible embeddings endpoint, so the pipeline can be
 * demonstrated end to end without an API key or a network round trip.
 *
 *   bun scripts/demo/stub-embeddings.ts
 *   EMBEDDING_BASE_URL=http://127.0.0.1:39500 bun run wuzzy embed
 *
 * NOT AN EMBEDDING MODEL. Vectors are a hashed bag of words: deterministic and
 * good enough to show retrieval wiring working, useless for real relevance.
 * A real index must point EMBEDDING_BASE_URL at a real model.
 */
const DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);
const PORT = Number(process.env.STUB_EMBEDDINGS_PORT ?? 39500);

function embed(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 0;
    for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) % DIMENSIONS;
    vector[hash] = (vector[hash] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const body = (await request.json()) as { input: string | string[] };
    const input = Array.isArray(body.input) ? body.input : [body.input];
    return Response.json({
      object: 'list',
      model: 'stub-embeddings',
      data: input.map((text, index) => ({ object: 'embedding', index, embedding: embed(text) })),
    });
  },
});

console.log(`stub embeddings on http://127.0.0.1:${PORT}  (NOT a real model)`);

// Keeps this file a module, so its top-level names stay out of the global scope.
export {};
