import { IsNull } from 'typeorm';
import type { DataSource } from 'typeorm';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { chunk } from './chunker';
import { createEmbedder, toVectorLiteral, type Embedder } from './embedder';

export interface EmbedOptions {
  readonly embedder?: Embedder;
  /** Documents per pass; the whole corpus by default. */
  readonly limit?: number;
  /** Texts per embedding request. */
  readonly batchSize?: number;
}

export interface EmbedSummary {
  readonly documents: number;
  readonly chunks: number;
}

/**
 * Embeds every document the crawler has left with embedded_at null.
 *
 * Restartable by construction: the work queue is a query, embedded_at is only
 * set once a document's chunks are committed, and the crawler clears it again
 * whenever content changes. So a re-run over an unchanged corpus does nothing,
 * an interrupted run resumes where it stopped, and a changed document is
 * re-embedded without anyone tracking state outside the database.
 */
export async function embedPending(
  dataSource: DataSource,
  options: EmbedOptions = {},
): Promise<EmbedSummary> {
  const embedder = options.embedder ?? createEmbedder();
  const batchSize = options.batchSize ?? 64;

  const pending = await dataSource.getRepository(DocumentEntity).find({
    where: { embeddedAt: IsNull() },
    order: { updatedAt: 'ASC' },
    ...(options.limit === undefined ? {} : { take: options.limit }),
  });

  let chunksWritten = 0;
  for (const document of pending) {
    const pieces = chunk(document.content);
    if (pieces.length === 0) {
      // Nothing embeddable, but the document is still handled: leaving
      // embedded_at null would make it reappear on every future pass.
      await dataSource
        .getRepository(DocumentEntity)
        .update({ id: document.id }, { embeddedAt: new Date() });
      continue;
    }

    const vectors: number[][] = [];
    for (let start = 0; start < pieces.length; start += batchSize) {
      const batch = pieces.slice(start, start + batchSize);
      vectors.push(...(await embedder.embed(batch.map((piece) => piece.text))));
    }

    const embeddedAt = new Date();
    await dataSource.transaction(async (manager) => {
      // Replace wholesale: a re-embed after a content change must not leave
      // chunks from the previous version behind.
      await manager.getRepository(ChunkEntity).delete({ documentId: document.id });
      await manager.getRepository(ChunkEntity).insert(
        pieces.map((piece, index) => ({
          documentId: document.id,
          ordinal: piece.ordinal,
          text: piece.text,
          tokenCount: estimateTokens(piece.text),
          embedding: toVectorLiteral(vectors[index]!) as unknown as number[],
          embeddedAt,
        })),
      );
      await manager
        .getRepository(DocumentEntity)
        .update({ id: document.id }, { embeddedAt });
    });
    chunksWritten += pieces.length;
  }

  return { documents: pending.length, chunks: chunksWritten };
}

/** Rough enough for bookkeeping; nothing branches on it. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
