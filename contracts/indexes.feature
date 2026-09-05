@t2 @indexes
Feature: configurable indexes
  Every index is the same primitive, configured differently. "Global" indexes
  are owned by the Wuzzy operator wallet with visibility=listed and
  read_policy=open. Agents create their own via x402 payment, configure
  access, and query them through the same metered /search. The primitive is
  use-case-agnostic: research corpora, private working sets, tenant sites,
  and curated catalogs are configurations, not features. Provenance is a
  property of the FETCH, not the index: attestations are shared, public, and
  unchanged by index membership.

  Background:
    Given the API is running with the global index populated
    And the meter is enabled

  Scenario: unscoped search targets the global index
    When a client pays for /search without an index parameter
    Then results come from the global index only

  Scenario: agent commissions an index
    When a wallet pays the index-creation price for seeds it supplies within the page cap
    Then an index is created with that wallet as owner
    And crawl jobs are enqueued only for URLs not already in the document store
    And the response includes the index id and a status endpoint

  Scenario: index creation respects the page cap
    When a wallet requests index creation whose seeds expand beyond the page cap
    Then creation is rejected before payment is settled
    And the response states the cap

  Scenario: shared documents are crawled and attested once
    Given a URL already in the document store with an attestation
    When a new index includes that URL
    Then no re-crawl occurs
    And the existing attestation uid is served for it in both indexes

  Scenario: index status reaches ready
    Given a newly commissioned index
    When its enqueued crawls complete
    Then the status endpoint reports ready with page and attestation counts

  Scenario: scoped search returns only member documents
    Given a ready index owned by wallet A
    When wallet A pays for /search scoped to that index
    Then every result's document is a member of that index
    And each result carries its provenance block and attestation uid

  Scenario: allowlist read policy admits listed wallets
    Given a ready index with read_policy allowlist including wallet B
    When wallet B pays for /search scoped to that index
    Then the response status is 200

  Scenario: allowlist read policy rejects unlisted wallets before settlement
    Given a ready index with read_policy allowlist not including wallet C
    When wallet C submits payment for /search scoped to that index
    Then the response status is 403
    And wallet C's payment is not settled

  Scenario: unlisted indexes do not appear in the catalog
    Given an index with visibility unlisted
    When a client fetches the public index catalog
    Then that index is absent
    But the global index is present

  Scenario: private index of public content hides curation, not crawling
    Given an allowlist index containing publicly crawled URLs
    Then those URLs' attestations remain publicly visible on Base
    And the index's existence, membership, and queryability are not derivable from attestations

  Scenario: owner appends to their index over time
    Given a ready index owned by wallet A
    When wallet A pays to append URLs within the page cap
    Then URLs not already in the document store are enqueued for crawling
    And already-stored URLs join the index immediately with their existing attestations
    And the appended pages become searchable in that index once crawled

  Scenario: only the owner may append
    Given a ready index owned by wallet A
    When wallet D submits payment to append URLs to it
    Then the response status is 403
    And wallet D's payment is not settled

  Scenario: deleting an index removes membership only
    Given a ready index whose owner requests deletion
    Then the index and its membership rows are removed
    And no documents or attestations are deleted
