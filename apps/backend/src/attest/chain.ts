/**
 * Which chain attestations are written to, and everything that follows from it.
 *
 * One setting rather than three, because the failure it prevents is silent: an
 * RPC pointed at one network with an explorer link pointed at another produces
 * results whose provenance block links to an attestation that does not exist
 * there. "Check it yourself" is the entire claim, so the link has to be right
 * by construction rather than by remembering to change it.
 */
export type AttestChain = 'base' | 'base-sepolia';

interface ChainSettings {
  readonly rpcUrl: string;
  readonly easscan: string;
}

/**
 * EAS and the schema registry are OP Stack predeploys at the same addresses on
 * both networks, so the address is not part of this table. EAS_ADDRESS still
 * overrides it for a chain where that stops being true.
 */
export const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020';

const CHAINS: Record<AttestChain, ChainSettings> = {
  base: { rpcUrl: 'https://mainnet.base.org', easscan: 'https://base.easscan.org' },
  'base-sepolia': {
    rpcUrl: 'https://sepolia.base.org',
    easscan: 'https://base-sepolia.easscan.org',
  },
};

export class UnknownChainError extends Error {}

export function attestChain(env: Record<string, string | undefined> = process.env): AttestChain {
  const chain = (env.EAS_CHAIN ?? 'base') as AttestChain;
  if (!(chain in CHAINS)) {
    throw new UnknownChainError(
      `EAS_CHAIN must be one of ${Object.keys(CHAINS).join(', ')}, got "${chain}"`,
    );
  }
  return chain;
}

export function chainSettings(env: Record<string, string | undefined> = process.env): ChainSettings {
  return CHAINS[attestChain(env)];
}
