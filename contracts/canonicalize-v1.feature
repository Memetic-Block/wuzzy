@t1 @protocol-v1
Feature: wuzzy/crawl canonicalization protocol v1
  The canonicalizer is the pinned public procedure that every EAS attestation's
  protocolVersion=1 refers to. These scenarios + the fixture vectors in
  fixtures/canonicalize-v1/ ARE the protocol spec in executable form; VERIFY.md
  is its prose twin. Once the first mainnet attestation lands, this feature and
  its fixtures are FROZEN — behavior changes are protocol v2 in a new feature.

  Background:
    Given the canonicalizer implementation for protocol "wuzzy/crawl" version 1

  Scenario Outline: conformance vectors reproduce pinned markdown and hash
    Given fixture input "<input>"
    When it is canonicalized under protocol v1
    Then the canonical markdown equals fixture "<expected_md>"
    And the sha256 content hash equals the value in "<expected_hash>"

    Examples:
      | input                      | expected_md                   | expected_hash                   |
      | docs-page.html             | docs-page.md                  | docs-page.hash                  |
      | code-blocks.html           | code-blocks.md                | code-blocks.hash                |
      | nested-lists.html          | nested-lists.md               | nested-lists.hash               |
      | unicode-nfc.html           | unicode-nfc.md                | unicode-nfc.hash                |
      | crlf-endings.html          | crlf-endings.md               | crlf-endings.hash               |
      | trailing-whitespace.html   | trailing-whitespace.md        | trailing-whitespace.hash        |
      | markdown-native.md         | markdown-native.expected.md   | markdown-native.hash            |
      | readability-fallback.html  | readability-fallback.md       | readability-fallback.hash       |

  Scenario: scripts, styles and comments never reach the hash
    Given fixture input "inline-code.html" with an inline script, a style block and comments
    When it is canonicalized under protocol v1
    Then the canonical markdown contains none of their text
    And it contains the article body

  Scenario: normalization is idempotent
    Given any canonical markdown output from protocol v1
    When it is normalized again under protocol v1
    Then the output is byte-identical
    And the content hash is unchanged

  Scenario: thin pages are rejected, not hashed
    Given fixture input "thin-page.html" whose extracted content is under 80 characters
    When it is canonicalized under protocol v1
    Then the pipeline marks the page as skipped
    And no document row or attestation is produced for it

  Scenario: raw hash commits to exact received bytes
    Given fixture input "docs-page.html" as a byte stream
    When the raw hash is computed
    Then it equals sha256 over those exact bytes with no normalization applied
