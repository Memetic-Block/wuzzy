# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# Crawl workers. The thing that actually fetches pages someone paid for.
#
# The API takes the money and writes what is owed; this drains it. Same image as
# the API, no HTTP, no ports, and nothing registered for other jobs to find:
# a worker is a consumer, so it is reached through Redis rather than addressed.
#
# Scale by raising `count`. Each index is crawled by one worker at a time,
# because the crawler already parallelises and spaces its own requests per host,
# so a second worker over the same rows would double the rate at a site without
# either half knowing. More workers means more indexes crawled at once, never
# one index crawled harder.
#
# It also embeds what it fetched and asks the attester for receipts, so an index
# is searchable and provable from the one payment. It holds no funded key: the
# attest queue is a separate job for exactly that reason.
job "wuzzy-worker" {
  datacenters = ["mb-hel"]
  type        = "service"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-worker-group" {
    count = 2

    network {
      mode = "bridge"
    }

    task "wuzzy-worker-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-b13567c0482148c34cfeda3bebfd42bd5febd8cf"
        entrypoint = ["/bin/sh", "-c"]
        args       = ["bun apps/backend/src/worker.ts"]
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
        EAS_CHAIN     = "base"
      }

      template {
        data        = <<-EOT
        {{- range service "wuzzy-db" }}
        POSTGRES_HOST={{ .Address }}
        POSTGRES_PORT={{ .Port }}
        {{- end }}
        {{- range service "wuzzy-redis" }}
        REDIS_HOST={{ .Address }}
        REDIS_PORT={{ .Port }}
        {{- end }}
        {{- with secret "kv/wuzzy/api" }}
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        {{- /* The worker embeds what it crawls, so it needs the provider. */}}
        EMBEDDING_API_KEY={{ .Data.data.EMBEDDING_API_KEY }}
        {{- end }}
        EOT
        destination = "secrets/worker.env"
        env         = true
      }

      # A crawl is long. Let one finish rather than cutting a paid-for job in
      # half; anything unfinished is still owed in `index_urls` and the sweeper
      # will ask again, but finishing is cheaper than re-fetching.
      kill_timeout = "5m"

      resources {
        cpu    = 1024
        memory = 2048
      }
    }
  }
}
