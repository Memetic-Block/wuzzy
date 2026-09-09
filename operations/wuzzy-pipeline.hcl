# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# Crawl then embed, on a schedule.
#
# The stages are CLI commands rather than queue workers, so this is a periodic
# batch job and not a daemon. Both are idempotent: the crawler skips pages a
# sitemap says have not changed and anything fetched inside CRAWL_MAX_AGE_DAYS,
# and the embed pass only picks up documents whose embedded_at is null, which
# the crawler clears whenever content changes.
#
# Attesting is deliberately NOT here. It spends money and needs a key, so it is
# a separate job a human runs.
job "wuzzy-pipeline" {
  datacenters = ["mb-hel"]
  type        = "batch"

  periodic {
    # Nightly, off-peak for the sites being crawled.
    cron             = "0 3 * * *"
    prohibit_overlap = true
  }

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-pipeline-group" {
    count = 1

    task "wuzzy-pipeline-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-577fd65513a56310c10de508e4bcc199b2250f5a"
        entrypoint = ["/bin/sh", "-c"]
        # Not `set -e`. Embedding what the crawl landed is worth doing even
        # when the crawl itself reports a problem, and chaining them meant one
        # unreachable URL discarded a whole corpus: the crawl exited non-zero,
        # the shell stopped, and 3,751 pages sat unembedded and unattested
        # while the job reported nothing but its own failure. Both stages run,
        # both statuses are kept, and the job fails if either did.
        args = [
          "bun apps/backend/src/cli/wuzzy.ts crawl; crawled=$?; bun apps/backend/src/cli/wuzzy.ts embed; embedded=$?; [ $crawled -eq 0 ] && [ $embedded -eq 0 ]",
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
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        EMBEDDING_API_KEY={{ .Data.data.EMBEDDING_API_KEY }}
        {{- end }}
        EOT
        destination = "secrets/pipeline.env"
        env         = true
      }

      restart {
        attempts = 0
        mode     = "fail"
      }

      resources {
        cpu    = 2048
        memory = 2048
      }
    }
  }
}
