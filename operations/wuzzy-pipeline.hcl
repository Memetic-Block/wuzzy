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
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-634ca1a428f849e7dcaa306b41f561291f3062a0"
        entrypoint = ["/bin/sh", "-c"]
        args = [
          "set -e; bun apps/backend/src/cli/wuzzy.ts crawl; bun apps/backend/src/cli/wuzzy.ts embed",
        ]
      }

      env {
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
