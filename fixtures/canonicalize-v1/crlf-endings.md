Webhooks are delivered at least once. A receiver that is slow to acknowledge, or that returns a non-2xx status, will see the same event again on the next retry, so every handler has to be idempotent with respect to the event identifier.

## Retry schedule

Failed deliveries are retried with exponential backoff for up to twenty-four hours. After the final attempt the event is dropped and recorded as undelivered in the dashboard, where it can be replayed by hand if it still matters.

## Verifying the signature

Every request carries a signature header computed over the raw body. Verify it before parsing, and compare with a constant-time function:

```
const expected = hmacSha256(secret, rawBody)
if (!timingSafeEqual(expected, header)) {
  return new Response('bad signature', { status: 401 })
}
```

Parsing before verifying means an attacker chooses what your parser sees, which is a larger attack surface than the comparison you are trying to protect.
