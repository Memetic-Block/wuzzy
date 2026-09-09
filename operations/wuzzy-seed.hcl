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
#   attestation, half a cent at 2,493 USD. The caps below bound the run at
#   1,500 pages, about 7.50 USD, which fits inside the 0.00398 ETH the attester
#   holds without topping it up. Raise them and fund it first, or the attester
#   runs out mid-corpus and retries every minute until it is funded.
#
# The per-host cap is what spreads the budget. docs.cdp.coinbase.com alone lists
# 2,357 sitemap URLs and would otherwise consume the whole run before the
# crawler reached the fifth seed.
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
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-b13567c0482148c34cfeda3bebfd42bd5febd8cf"
        entrypoint = ["/bin/sh", "-c"]
        args = [
          "set -e; bun apps/backend/src/cli/wuzzy.ts crawl --per-host=250 --max=1500; bun apps/backend/src/cli/wuzzy.ts embed",
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
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD | required "POSTGRES_PASSWORD missing from kv/wuzzy/api" }}
        EMBEDDING_API_KEY={{ .Data.data.EMBEDDING_API_KEY | required "EMBEDDING_API_KEY missing from kv/wuzzy/api" }}
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
