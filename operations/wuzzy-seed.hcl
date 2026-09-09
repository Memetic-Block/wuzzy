# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# Seeds the global index: crawl the curated seed list, then embed what landed.
#
# This is the "run `wuzzy crawl` by hand" that README.md describes, submitted as
# a job rather than typed into an allocation, because the database is on the
# private network and the embedding key is in Vault. Neither is reachable from a
# laptop, and a shell in a running container is not a record of what was run.
#
# Not wuzzy-pipeline.hcl, which is the same two commands on a nightly schedule.
# Submitting that one registers a recurring crawl, and a recurring crawl spends
# gas on a schedule: a changed page clears its UID and is attested again. The
# first pass over a corpus should be watched, so it is one shot and separate.
#
# Idempotent, and safe to re-run after a failure. The crawler skips pages a
# sitemap reports unchanged and anything fetched inside CRAWL_MAX_AGE_DAYS
# (14), and the embed pass only picks up documents whose embedded_at is null.
# A run that dies halfway resumes rather than starting over.
#
# **The receipts are not optional and are not in this job.** wuzzy-attester is a
# running service whose sweeper derives its work from the database, so every
# document this job embeds is attested within a minute of the embed pass, with
# no further instruction. Sizing the crawl is therefore sizing the spend:
#
#   Measured on Base on 2026-09-09, tx 0xe7a9adca...b61c: 334,381 gas at
#   0.006 gwei plus an L1 fee of 0.0000000015 ETH, so 0.0000020 ETH per
#   attestation, half a cent at 2,493 USD. The four seeds that publish sitemaps
#   list 3,761 URLs between them, so a full pass is about 19 USD.
#
# `--max` is a circuit breaker rather than a budget, which is why it sits well
# above that figure. Three of the seven seeds publish no sitemap and are reached
# by following links instead, and a link-followed host can expose an unbounded
# URL space through pagination or a calendar. Scope is the exact host, so the
# damage is capped at one site either way, but a run that stops at a number
# somebody chose is easier to read than one that stops when a quota runs out.
#
# There is deliberately no `--per-host` cap. It would truncate whichever host
# the crawler reaches with the budget already spent, and truncating a corpus by
# sitemap order drops pages for a reason that has nothing to do with what they
# say. docs.cdp.coinbase.com is 2,357 of those URLs, the x402 reference among
# them, and a partial copy of it is worse than a complete one is skewed.
job "wuzzy-seed" {
  datacenters = ["mb-hel"]
  type        = "batch"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-seed-group" {
    count = 1

    # One shot. A crawl that failed should be read before it is retried: the
    # interesting failures are a seed that stopped serving content or an
    # embedding quota, and both are worse for being retried automatically.
    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 0
      mode     = "fail"
    }

    task "wuzzy-seed-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-24aa7209b07167309ee2b412ba1e335cfb344c2a"
        entrypoint = ["/bin/sh", "-c"]
        # Not `set -e`. Embedding what the crawl landed is worth doing even
        # when the crawl itself reports a problem, and chaining them meant one
        # unreachable URL discarded a whole corpus: the crawl exited non-zero,
        # the shell stopped, and 3,751 pages sat unembedded and unattested
        # while the job reported nothing but its own failure. Both stages run,
        # both statuses are kept, and the job fails if either did.
        args = [
          "bun apps/backend/src/cli/wuzzy.ts crawl --max=6000; crawled=$?; bun apps/backend/src/cli/wuzzy.ts embed; embedded=$?; [ $crawled -eq 0 ] && [ $embedded -eq 0 ]",
        ]
      }

      env {
        # Gemini through its OpenAI-compatible layer, which is the shape the
        # client in apps/backend/src/embed/embedder.ts already speaks. The size
        # is not free choice: it must match the `vector(1536)` column and its
        # hnsw index. gemini-embedding-001 returns 3072 by default and truncates
        # to 1536 on request, and pgvector cannot build an hnsw index above 2000
        # dimensions, so the default would be unindexable as well as wrong.
        EMBEDDING_BASE_URL   = "https://generativelanguage.googleapis.com/v1beta/openai"
        EMBEDDING_MODEL      = "gemini-embedding-001"
        EMBEDDING_DIMENSIONS = "1536"

        POSTGRES_DB   = "wuzzy"
        POSTGRES_USER = "wuzzy"
        WUZZY_USER_AGENT = "WuzzyBot"
      }

      template {
        data        = <<-EOT
        {{- range service "wuzzy-db" }}
        POSTGRES_HOST={{ .Address }}
        POSTGRES_PORT={{ .Port }}
        {{- end }}
        {{- with secret "kv/wuzzy/api" }}
        POSTGRES_PASSWORD="{{ .Data.data.POSTGRES_PASSWORD }}"
        EMBEDDING_API_KEY="{{ .Data.data.EMBEDDING_API_KEY }}"
        {{- end }}
        EOT
        destination = "secrets/seed.env"
        env         = true
      }

      resources {
        cpu    = 2048
        memory = 2048
      }
    }
  }
}
