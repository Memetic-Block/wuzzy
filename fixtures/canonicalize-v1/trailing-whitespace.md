The public RPC endpoints are shared infrastructure and are rate limited per source address. They exist so that you can build and test without signing up for anything, not so that you can run production traffic through them for free.

## What the limits are

Limits are deliberately not published as exact numbers, because they move with capacity. Treat a 429 response as normal operating feedback rather than an error: back off, retry with jitter, and reduce your request rate.

## Getting more headroom

Move to a dedicated node provider, or run your own node. Either way the API key belongs in your deployment environment and never in the client bundle, where anybody who opens developer tools can lift it and spend your quota.
