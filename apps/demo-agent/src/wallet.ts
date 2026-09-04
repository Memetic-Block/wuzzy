import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * Where a demo wallet is kept.
 *
 * Deliberately outside the repository: a funded key must never be able to land
 * in a commit, and defaulting anywhere under the working tree makes that a
 * matter of remembering to gitignore it. Override with WUZZY_WALLET_FILE.
 */
export function walletPath(env: Record<string, string | undefined> = process.env): string {
  if (env.WUZZY_WALLET_FILE) return env.WUZZY_WALLET_FILE;
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config');
  return join(base, 'wuzzy', 'demo-wallet.json');
}

export interface DemoWallet {
  readonly privateKey: Hex;
  readonly address: Hex;
}

export class NoWalletError extends Error {}

/** Creates a fresh wallet and stores it 0600. Never prints the key. */
export async function createWallet(path = walletPath()): Promise<DemoWallet> {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ privateKey, address }, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);

  return { privateKey, address };
}

/** Loads the wallet from DEMO_PRIVATE_KEY, else from the wallet file. */
export async function loadWallet(
  env: Record<string, string | undefined> = process.env,
  path = walletPath(env),
): Promise<DemoWallet> {
  const fromEnv = env.DEMO_PRIVATE_KEY;
  if (fromEnv) {
    const privateKey = (fromEnv.startsWith('0x') ? fromEnv : `0x${fromEnv}`) as Hex;
    return { privateKey, address: privateKeyToAccount(privateKey).address };
  }

  try {
    const stored = JSON.parse(await readFile(path, 'utf8')) as DemoWallet;
    if (!stored.privateKey) throw new Error('no privateKey field');
    return { privateKey: stored.privateKey, address: privateKeyToAccount(stored.privateKey).address };
  } catch {
    throw new NoWalletError(
      `no wallet at ${path}. Run "bun run demo wallet" to create one, or set DEMO_PRIVATE_KEY.`,
    );
  }
}
