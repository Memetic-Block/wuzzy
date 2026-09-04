This guide walks through deploying a contract to Base Sepolia and then to Base mainnet. It assumes you already have a funded testnet wallet and a working Foundry installation. If you do not, start with the quickstart guide first, which covers installing the toolchain and requesting testnet funds from the faucet.

## Prerequisites

Before you begin, confirm that your environment has the toolchain installed and that your wallet holds enough testnet ETH to cover deployment gas. Deployment on Base Sepolia typically costs a negligible amount, but the transaction will revert outright if the account balance is zero.

## Configure the network

Add the Base Sepolia RPC endpoint to your configuration. The public endpoint is rate limited and is intended for development traffic only; production deployments should use a dedicated node provider with an API key held outside version control.

## Deploy

Run the deployment script against the configured network. The command prints the deployed address along with the transaction hash, both of which you will need in order to verify the contract on the block explorer in the next guide.

### Confirming the deployment

Look up the transaction hash on the explorer. A successful deployment shows a contract creation with a non-empty bytecode payload at the resulting address.

Once the contract is live, continue to the verification guide so that the source is published alongside the bytecode and other developers can read what you shipped.
