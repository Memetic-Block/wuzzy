# Paymaster overview

A paymaster sponsors gas on behalf of a user so that an account can transact without holding ETH. The user signs the operation as usual; the paymaster attaches its own signature agreeing to cover the cost, and the bundler submits the pair.

## When to sponsor

Sponsorship is most useful for a first-time user who has nothing in their wallet yet. Once the account holds a balance, paying its own gas is simpler and removes a dependency on your infrastructure being available at the moment they transact.

## Policies

A policy decides which operations you are willing to pay for. Scope it as tightly as you can: by contract address, by function selector, and by a per-account spend ceiling. An open policy is a funded address that anyone on the internet can drain.

## Limits

Sponsored operations still consume the same gas on chain. The paymaster changes who pays, not how much, so a badly optimized contract stays expensive and the cost lands on you rather than on the user who triggered it.
