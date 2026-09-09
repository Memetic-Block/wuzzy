@t2 @discovery
Feature: machine-readable discovery
  An agent that has never been told about this API has to be able to find out
  what it costs and how to pay from the API itself. The site and the docs are
  rendered for people; this is the same facts in the one format a program can
  read without parsing markup, and it is generated from the running
  configuration so it cannot advertise a price the meter does not quote.

  Scenario: an agent learns the endpoints without being told about them
    When a client GETs /llms.txt
    Then the response status is 200
    And the content type is text/plain
    And the body names the search and index endpoints

  Scenario: the published prices are the ones the meter quotes
    Given the meter is enabled
    When a client GETs /llms.txt
    Then the query price in the body is the price the meter quotes for a search
    And the per-page price in the body is the price a commission is billed at

  Scenario: the payment handshake is described where a payer will look
    When a client GETs /llms.txt
    Then the body says an unpaid request answers 402 with the requirements
    And the body names the network and the asset payments settle in

  Scenario: a machine can find a human
    When a client GETs /llms.txt
    Then the body carries a contact address in plain text
