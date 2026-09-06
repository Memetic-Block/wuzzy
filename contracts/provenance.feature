@t2 @provenance
Feature: crawl provenance lifecycle
  Every fetch leaves an append-only provenance trail; the documents table holds
  latest state; content changes invalidate downstream embedding and attestation;
  verification is deterministic re-execution under the pinned protocol version.

  Background:
    Given a running database with the wuzzy schema
    And a mock site serving fixture pages

  Scenario: fresh fetch produces document and provenance rows
    When the crawler fetches an allowed URL for the first time
    Then a documents row exists with raw_hash, content_hash, protocol_version 1, and robots_status "allowed"
    And a fetch_log row records the same hashes and an http status
    And embedded_at and attestation_uid are null

  Scenario: unchanged re-fetch appends provenance without touching state
    Given a URL already indexed with content hash H
    When the crawler re-fetches it and the canonical content still hashes to H
    Then a new fetch_log row is appended
    And the documents row keeps its embedded_at and attestation_uid

  Scenario: changed content invalidates downstream artifacts
    Given a URL already indexed, embedded, and attested
    When the crawler re-fetches it and the canonical content hashes to a new value
    Then the documents row carries the new content_hash
    And embedded_at is cleared so the embed pass will re-embed it
    And attestation_uid is cleared so the attestor will re-attest it

  Scenario: a page the sitemap calls unchanged is not re-fetched
    Given an indexed document whose sitemap lastmod is older than our fetch
    When the crawler runs again
    Then the URL is not requested
    And the document is left exactly as it was

  Scenario: a page the sitemap calls changed is re-fetched
    Given an indexed document whose sitemap lastmod is newer than our fetch
    When the crawler runs again
    Then the URL is requested
    And the content hash decides whether anything actually changed

  Scenario: a page with no sitemap claim is judged on age alone
    Given an indexed document that no sitemap mentions
    When the crawler runs again within the maximum age
    Then the URL is not requested
    But it is requested once it is older than the maximum age

  Scenario: a stale document is re-fetched however fresh the sitemap claims it is
    Given an indexed document older than the maximum age
    And a sitemap lastmod older than our fetch
    When the crawler runs again
    Then the URL is requested anyway

  Scenario: a page that stops yielding content leaves the index
    Given an indexed document whose page now returns too little content to index
    When the crawler fetches it again
    Then the document is marked unindexed and its chunks are removed
    But its hashes, its fetch history and its attestation uid are unchanged
    And it no longer appears in search results

  Scenario: a page that starts yielding content again returns to the index
    Given a document marked unindexed by an earlier fetch
    When a later fetch produces indexable content
    Then the unindexed mark is cleared
    And the document is queued for embedding so it can be searched again

  Scenario: a request that returns an error is still recorded
    When the crawler fetches a URL that answers with an error status
    Then a fetch_log row records the URL, the status and the error
    And no document row is created for it

  Scenario: a request that returns something unindexable is still recorded
    When the crawler fetches a URL that answers with a non-page body
    Then a fetch_log row records the URL and why it was unusable
    And no document row is created for it

  Scenario: disallowed URLs are never fetched
    Given a URL disallowed by the site's robots.txt for WuzzyBot
    When seed discovery runs for that site
    Then the URL is never enqueued
    And no fetch_log row exists for it

  Scenario: robots rules are read as WuzzyBot, not as the wildcard agent
    Given a robots.txt with a "WuzzyBot" group disallowing "/private/"
    And a wildcard "*" group that allows "/private/"
    When seed discovery evaluates a URL under "/private/"
    Then the URL is treated as disallowed
    And no fetch_log row exists for it

  Scenario: a redirect off the seeded hosts is not followed
    Given a seeded page that redirects to a URL on another host
    When the crawler fetches it
    Then no request is made to the other host
    And no document row exists for either URL

  Scenario: every request identifies the crawler honestly
    Given a site whose robots.txt and pages are both fetched during a crawl
    When the crawl completes
    Then every request the crawler made carried the configured WuzzyBot user-agent
    And no request carried a browser user-agent string

  @verify
  Scenario: verify matches an unchanged page
    Given an indexed URL whose live content still canonicalizes to the attested hash
    When "wuzzy verify <url>" runs
    Then it exits 0
    And prints the attested hash, the recomputed hash, and the attestation link

  @verify
  Scenario: verify reports a mismatch
    Given an indexed URL whose live content canonicalizes to a different hash
    When "wuzzy verify <url>" runs
    Then it exits 1
    And prints both hashes so the discrepancy is inspectable

  @verify
  Scenario: verify on an unindexed URL
    Given a URL absent from the index
    When "wuzzy verify <url>" runs
    Then it exits 2
