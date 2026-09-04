import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

/**
 * The EAS schema every Wuzzy attestation is written against.
 *
 * Only hashes and metadata go onchain, never content. That is an invariant, not
 * an optimization: the index is public, the corpus is other people's writing,
 * and an attestation is a commitment to what was fetched rather than a copy of
 * it. `schemaCarriesNoContent` below is the check that keeps it true.
 */
export const SCHEMA_DEFINITION =
  'string url,string protocol,uint8 protocolVersion,bytes32 contentHash,bytes32 rawHash,uint64 fetchedAt';

export interface AttestationFields {
  readonly url: string;
  readonly protocol: string;
  readonly protocolVersion: number;
  readonly contentHash: string;
  readonly rawHash: string;
  readonly fetchedAt: Date;
}

const hex32 = (value: string): string => (value.startsWith('0x') ? value : `0x${value}`);

export function encodeAttestation(fields: AttestationFields): string {
  return new SchemaEncoder(SCHEMA_DEFINITION).encodeData([
    { name: 'url', value: fields.url, type: 'string' },
    { name: 'protocol', value: fields.protocol, type: 'string' },
    { name: 'protocolVersion', value: fields.protocolVersion, type: 'uint8' },
    { name: 'contentHash', value: hex32(fields.contentHash), type: 'bytes32' },
    { name: 'rawHash', value: hex32(fields.rawHash), type: 'bytes32' },
    { name: 'fetchedAt', value: Math.floor(fields.fetchedAt.getTime() / 1000), type: 'uint64' },
  ]);
}

export function decodeAttestation(encoded: string): Record<string, string> {
  const decoded = new SchemaEncoder(SCHEMA_DEFINITION).decodeData(encoded);
  return Object.fromEntries(decoded.map((field) => [field.name, String(field.value.value)]));
}

/** Field names that would mean the corpus itself was being published onchain. */
const CONTENT_FIELDS = ['content', 'markdown', 'body', 'text', 'html', 'snippet', 'title'];

/**
 * Guards the invariant at the schema level, so adding a content field to
 * SCHEMA_DEFINITION fails the build rather than reaching mainnet.
 */
export function schemaCarriesNoContent(definition = SCHEMA_DEFINITION): boolean {
  const names = definition.split(',').map((field) => field.trim().split(/\s+/)[1]?.toLowerCase());
  return !names.some((name) => name !== undefined && CONTENT_FIELDS.includes(name));
}
