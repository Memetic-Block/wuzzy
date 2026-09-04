Contract reads are free. They execute against a node's local state and never produce a transaction, so no gas is spent and no wallet signature is required. This page shows the same read performed with three different toolchains so that you can pick whichever one already fits your project.

## With viem

Instantiate a public client against a Base RPC endpoint and call the function:

```
import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'

const client = createPublicClient({ chain: base, transport: http() })

const total = await client.readContract({
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  abi,
  functionName: 'totalSupply',
})
```

## With cast

Foundry's `cast call` does the same thing from a shell:

```
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "totalSupply()(uint256)" \
  --rpc-url https://mainnet.base.org
```

## Raw JSON-RPC

If you would rather not add a dependency, post to the endpoint directly. Note that the block tag is required and that `<address>` below is a placeholder:

```
{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"<address>","data":"0x18160ddd"},"latest"],"id":1}
```

All three return the same value. Use `formatUnits` to render it.
