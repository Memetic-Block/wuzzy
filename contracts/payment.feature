@t2 @payment
Feature: x402-metered search
  /search is keyless: no accounts, no API keys. Payment is the only gate, and
  it is optional only in explicit dev mode. Every successful response carries
  per-result provenance so paying agents can verify what they bought.

  Background:
    Given the API is running with an indexed corpus

  Scenario: unpaid request receives payment requirements
    Given the meter is enabled
    When a client POSTs to /search without payment
    Then the response status is 402
    And the body contains x402 payment requirements including price and pay-to address
    And no search results are returned

  Scenario: paid request returns results with provenance
    Given the meter is enabled
    When a client POSTs to /search with a valid x402 payment
    Then the response status is 200
    And each result includes url, title, snippet, and score
    And each result's provenance block includes protocol, protocolVersion, contentHash, fetchedAt
    And each attested result includes its attestationUid and an easscan URL

  Scenario: malformed or insufficient payment is rejected
    Given the meter is enabled
    When a client POSTs to /search with an invalid payment header
    Then the response status is 402
    And no search results are returned

  Scenario: dev mode serves openly and says so
    Given the meter is disabled via X402_ENABLED=false
    When a client POSTs to /search without payment
    Then the response status is 200

  @mainnet @manual
  Scenario: settlement lands onchain
    Given the meter is enabled against Base mainnet with a fresh receiving address
    When one real paid query completes from an external wallet
    Then a USDC transfer to the receiving address is visible on Basescan
    And the transaction link is recorded in the evidence pack

  Scenario: queries are rejected when empty
    When a client POSTs to /search with a blank query
    Then the response status is 400
