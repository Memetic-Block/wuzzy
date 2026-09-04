# Proposed additions to contracts/canonicalize-v1.feature

Not merged. `canonicalize-v1.feature` and its Examples table freeze soon, so nothing here
touches the existing scenarios; these are candidates to add before the freeze, plus one
wording question on a scenario that already exists.

Each is a property the current scenarios do not pin, which means a future refactor could
change it without failing CI, and an independent verifier could reasonably implement it
differently.

## Wording question on an existing scenario

`Scenario: thin pages are rejected, not hashed` reads "whose extracted content is under 80
characters". Two stages could be meant: the text Readability extracts, or the canonical
markdown after normalization. The implementation measures the canonical markdown, trimmed,
because that is the only value a third-party verifier can reproduce without also reproducing
our extraction internals. If you agree, the scenario text is worth making explicit before it
freezes; if you meant the extracted text, the implementation needs to change instead.

## Proposed scenarios

```gherkin
  Scenario: site chrome never reaches the hash
    Given fixture input "docs-page.html" containing nav, sidebar and footer text
    When it is canonicalized under protocol v1
    Then the canonical markdown contains none of that text
    And it contains the article body

  Scenario: the fetch URL is part of the input
    Given fixture input "docs-page.html" canonicalized as fetched from two different URLs
    When relative links in the page resolve against each URL
    Then the two canonical outputs differ
    And each is stable across repeated runs at the same URL

  Scenario: line endings do not move the content hash
    Given fixture input "docs-page.html"
    And the same bytes with every LF replaced by CRLF
    When both are canonicalized under protocol v1
    Then the content hashes are equal
    And the raw hashes differ

  Scenario: malformed markup canonicalizes without failing
    Given fixture input "malformed.html" with unclosed and mis-nested tags
    When it is canonicalized under protocol v1
    Then a canonical markdown output is produced
    And canonicalizing it a second time yields the identical hash

  Scenario: invalid UTF-8 bytes decode deterministically
    Given fixture input "invalid-utf8.html" containing a truncated multi-byte sequence
    When it is canonicalized under protocol v1
    Then the invalid sequence becomes U+FFFD in the canonical markdown
    And the content hash is the same on every run
```

The last two would need two new input fixtures, `malformed.html` and `invalid-utf8.html`.
Neither is covered by the current Examples table, and both are shapes a real crawl of the
open web will hit.
