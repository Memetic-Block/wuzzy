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
