import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IndexEntity, type IndexReadPolicy, type IndexVisibility } from '../database/index.entity';
import {
  INDEXES_CONFIG,
  buildIndexesConfig,
  priceForPages,
  type IndexesConfig,
} from './index.config';

/** Derived from the crawl queue, never stored. */
export type IndexStatus = 'pending' | 'crawling' | 'ready';

export interface IndexSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly visibility: IndexVisibility;
  readonly readPolicy: IndexReadPolicy;
  readonly pageCap: number | null;
  readonly createdAt: string;
}

export interface IndexStatusReport extends IndexSummary {
  readonly status: IndexStatus;
  /** Documents that are members of this index. */
  readonly pages: number;
  /** Of those, how many carry an attestation uid. */
  readonly attestations: number;
  /** URLs paid for that the store does not hold yet. */
  readonly pending: number;
  readonly statusUrl: string;
}

export interface CreateIndexRequest {
  readonly owner: string;
  readonly name?: string;
  readonly urls: readonly string[];
  readonly visibility?: IndexVisibility;
  readonly readPolicy?: IndexReadPolicy;
  readonly allowlist?: readonly string[];
}

export interface UrlIntake {
  /** Already in the document store; joined immediately, no crawl. */
  readonly joined: number;
  /** Not in the store; queued for `wuzzy crawl --index`. */
  readonly enqueued: number;
}

export class PageCapExceededError extends Error {
  constructor(
    readonly requested: number,
    readonly cap: number,
  ) {
    super(`this request covers ${requested} pages; the cap is ${cap}`);
  }
}

export class InvalidUrlError extends Error {}
export class InvalidWalletError extends Error {}
export class UnknownIndexError extends Error {}

/**
 * Indexes as configurations of one primitive, per contracts/indexes.feature.
 *
 * There is one document store. An index is a membership view over it, so a URL
 * two indexes both want is crawled, canonicalized and attested exactly once,
 * and provenance stays a property of the fetch rather than of the index.
 *
 * Access control rides x402: a verified payment proves control of the payer
 * wallet, so an allowlist needs no second auth mechanism. The check runs after
 * verification and before settlement, which is what makes rejection free.
 */
@Injectable()
export class IndexesService {
  private readonly config: IndexesConfig;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(INDEXES_CONFIG) @Optional() config?: IndexesConfig,
  ) {
    this.config = config ?? buildIndexesConfig();
  }

  get pageCap(): number {
    return this.config.pageCap;
  }

  /** Price a client is quoted in the 402 for taking on `pages` pages. */
  priceForPages(pages: number): string {
    return priceForPages(this.config.pricePerPage, pages);
  }

  /**
   * Adopts the configured operator wallet as the global index's owner. The
   * migration cannot know it, and leaving the row ownerless would make the
   * operator unable to append to their own index.
   */
  async ensureGlobalIndex(): Promise<IndexEntity> {
    const global = await this.repository().findOne({ where: { slug: this.config.globalSlug } });
    if (!global) throw new UnknownIndexError(`no index with slug "${this.config.globalSlug}"`);

    const owner = this.config.operatorWallet;
    if (owner && global.owner !== owner) {
      await this.repository().update({ id: global.id }, { owner, updatedAt: new Date() });
      global.owner = owner;
    }
    return global;
  }

  async globalIndex(): Promise<IndexEntity> {
    return this.ensureGlobalIndex();
  }

  /**
   * Resolves an index reference from a request. An absent reference is the
   * global index, which is what keeps every pre-existing search scenario true.
   */
  async resolve(reference?: string | null): Promise<IndexEntity> {
    const trimmed = reference?.trim();
    if (!trimmed) return this.globalIndex();

    const where = UUID.test(trimmed) ? { id: trimmed } : { slug: trimmed };
    const found = await this.repository().findOne({ where });
    if (!found) throw new UnknownIndexError(`no such index: ${trimmed}`);
    return found;
  }

  /**
   * Listed indexes only. Unlisted ones are absent, not redacted.
   *
   * The global index leads whatever was created since, because it is the one an
   * unscoped search reads and therefore the right default for anything that
   * renders this as a choice.
   */
  async catalog(): Promise<IndexSummary[]> {
    const rows = await this.repository().find({
      where: { visibility: 'listed' },
      order: { createdAt: 'DESC' },
    });
    // Sort is stable, so newest-first survives inside each group.
    const { globalSlug } = this.config;
    return rows
      .sort((a, b) => Number(b.slug === globalSlug) - Number(a.slug === globalSlug))
      .map(summarize);
  }

  async status(index: IndexEntity): Promise<IndexStatusReport> {
    const [counts] = (await this.dataSource.query(
      `SELECT
         (SELECT count(*) FROM index_documents m WHERE m.index_id = $1)::int AS pages,
         (SELECT count(*) FROM index_documents m
            JOIN documents d ON d.id = m.document_id
           WHERE m.index_id = $1 AND d.attestation_uid IS NOT NULL)::int AS attestations,
         (SELECT count(*) FROM index_urls u
           WHERE u.index_id = $1 AND u.crawled_at IS NULL)::int AS pending,
         (SELECT count(*) FROM index_urls u
           WHERE u.index_id = $1 AND u.crawled_at IS NOT NULL)::int AS crawled`,
      [index.id],
    )) as [{ pages: number; attestations: number; pending: number; crawled: number }];

    return {
      ...summarize(index),
      status: statusFrom(counts.pending, counts.crawled),
      pages: counts.pages,
      attestations: counts.attestations,
      pending: counts.pending,
      statusUrl: `/indexes/${index.id}`,
    };
  }

  async create(request: CreateIndexRequest): Promise<IndexEntity> {
    const urls = normalizeUrls(request.urls);
    this.assertWithinCap(urls.length);

    const owner = normalizeWallet(request.owner);
    return this.dataSource.transaction(async (manager) => {
      const created = await manager.getRepository(IndexEntity).save({
        slug: await uniqueSlug(manager, request.name),
        name: request.name?.trim() || 'Untitled index',
        owner,
        visibility: request.visibility ?? 'listed',
        readPolicy: request.readPolicy ?? 'open',
        pageCap: this.config.pageCap,
      });

      const readers = (request.allowlist ?? []).map(normalizeWallet).filter((w) => w !== owner);
      if (readers.length > 0) {
        await manager.query(
          `INSERT INTO index_readers (index_id, wallet)
           SELECT $1, w FROM unnest($2::text[]) w ON CONFLICT DO NOTHING`,
          [created.id, readers],
        );
      }

      await intake(manager, created.id, urls);
      return created;
    });
  }

  /**
   * Adds URLs to an existing index. URLs the store already holds join at once
   * with the attestations they already carry; the rest are queued for crawling.
   */
  async append(index: IndexEntity, requested: readonly string[]): Promise<UrlIntake> {
    const urls = normalizeUrls(requested);
    const existing = await this.dataSource.query(
      `SELECT
         (SELECT count(*) FROM index_documents WHERE index_id = $1)::int AS pages,
         (SELECT count(*) FROM index_urls WHERE index_id = $1 AND crawled_at IS NULL)::int AS pending`,
      [index.id],
    );
    const held = Number(existing[0].pages) + Number(existing[0].pending);
    this.assertWithinCap(held + urls.length, index.pageCap ?? this.config.pageCap);

    return this.dataSource.transaction((manager) => intake(manager, index.id, urls));
  }

  /** Drops the index and its membership. Documents and attestations survive. */
  async remove(index: IndexEntity): Promise<void> {
    await this.repository().delete({ id: index.id });
  }

  /**
   * Whether `wallet` may read this index. An open index admits any payer; an
   * allowlist index admits its owner and the wallets it lists.
   */
  async canRead(index: IndexEntity, wallet: string | null): Promise<boolean> {
    if (index.readPolicy === 'open') return true;
    if (!wallet) return false;

    const payer = normalizeWallet(wallet);
    if (payer === index.owner) return true;
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM index_readers WHERE index_id = $1 AND wallet = $2 LIMIT 1`,
      [index.id, payer],
    );
    return row !== undefined;
  }

  /** Only the owner writes. Collaborative policies are a roadmap item. */
  canWrite(index: IndexEntity, wallet: string | null): boolean {
    return wallet !== null && normalizeWallet(wallet) === index.owner;
  }

  private assertWithinCap(pages: number, cap = this.config.pageCap): void {
    if (pages > cap) throw new PageCapExceededError(pages, cap);
  }

  private repository() {
    return this.dataSource.getRepository(IndexEntity);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Stored and compared lowercased, so checksum casing cannot fork an identity. */
export function normalizeWallet(wallet: string): string {
  const trimmed = wallet.trim();
  if (!ADDRESS.test(trimmed)) throw new InvalidWalletError(`not an address: "${wallet}"`);
  return trimmed.toLowerCase();
}

function normalizeUrls(urls: readonly string[]): string[] {
  if (urls.length === 0) throw new InvalidUrlError('at least one URL is required');

  const seen = new Set<string>();
  for (const candidate of urls) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new InvalidUrlError(`not a URL: "${candidate}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InvalidUrlError(`not an http(s) URL: "${candidate}"`);
    }
    // The fragment never reaches the server, so two URLs differing only by one
    // are the same page and must not be billed or crawled twice.
    parsed.hash = '';
    seen.add(parsed.toString());
  }
  return [...seen];
}

function summarize(index: IndexEntity): IndexSummary {
  return {
    id: index.id,
    slug: index.slug,
    name: index.name,
    owner: index.owner,
    visibility: index.visibility,
    readPolicy: index.readPolicy,
    pageCap: index.pageCap,
    createdAt: new Date(index.createdAt).toISOString(),
  };
}

function statusFrom(pending: number, crawled: number): IndexStatus {
  if (pending === 0) return 'ready';
  return crawled > 0 ? 'crawling' : 'pending';
}

/**
 * Splits requested URLs against the store: known ones become membership rows,
 * unknown ones become queue rows. This is where "crawled once, shared by every
 * index that wants it" actually happens.
 */
async function intake(
  manager: { query(sql: string, params?: unknown[]): Promise<any> },
  indexId: string,
  urls: readonly string[],
): Promise<UrlIntake> {
  const joined = await manager.query(
    `INSERT INTO index_documents (index_id, document_id)
     SELECT $1, d.id FROM documents d WHERE d.url = ANY($2::text[])
     ON CONFLICT DO NOTHING
     RETURNING document_id`,
    [indexId, urls],
  );
  const enqueued = await manager.query(
    `INSERT INTO index_urls (index_id, url)
     SELECT $1, u FROM unnest($2::text[]) u
     WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.url = u)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [indexId, urls],
  );
  return { joined: joined.length, enqueued: enqueued.length };
}

/** A readable handle that stays unique without a retry loop on collision. */
async function uniqueSlug(
  manager: { query(sql: string, params?: unknown[]): Promise<any> },
  name: string | undefined,
): Promise<string> {
  const base =
    (name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'index';
  const rows = await manager.query(`SELECT slug FROM indexes WHERE slug = $1 OR slug LIKE $2`, [
    base,
    `${base}-%`,
  ]);
  const taken = new Set(rows.map((row: { slug: string }) => row.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
