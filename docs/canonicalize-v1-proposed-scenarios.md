# Proposed additions to contracts/canonicalize-v1.feature

**Landed 2026-09-06.** All five scenarios below are now in
`contracts/canonicalize-v1.feature` and covered by tests, along with a sixth that came out of
a real defect: scripts, styles and comments reaching the hash. This file is kept as the record
of what was proposed and what changed on the way in.

Two things moved during implementation:

- **"the fetch URL is part of the input" named the wrong fixture.** As proposed it used
  `docs-page.html`, but every relative link in that page is nav or footer, which Readability
  strips, so its output contains no links at all and the two URLs produced an identical hash.
  The property is real, so a fixture that exercises it was authored instead:
  `relative-links.html`, whose article body carries a root-relative link, a parent-relative
  link and an absolute one.
- **The thin-page wording question is unresolved and no longer blocking.** The scenario still
  reads "whose extracted content is under 80 characters" while the implementation measures
  canonical markdown after normalization. Left as-is deliberately: the identifier now carries
  `-experimental`, so nothing is frozen and the wording can be settled before the suffix is
  dropped.

Two new input fixtures were authored by hand, as inputs are the spec rather than generated
output: `malformed.html` (unclosed and mis-nested tags) and `invalid-utf8.html` (a truncated
multi-byte sequence). Neither is in the Examples table, because each is asserted as a property
rather than pinned to a hash.
