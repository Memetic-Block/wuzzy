# x402 payment flow

A client that has never paid gets a 402 back with the price and the address to
pay it to. It pays, retries with proof of payment attached, and gets results.

## The exchange

1. Client requests the resource with no payment header
2. Server answers 402 with payment requirements
3. Client signs a payment and retries
4. Server verifies, settles, and returns the resource

## Why keyless matters

There is no account to create and no key to rotate. An agent that holds funds can
reach the resource on its own, which is the whole point: nobody has to provision
credentials ahead of time for a caller they have never met.

```bash
curl -s https://api.example.com/search -d '{"q":"base"}'
```
