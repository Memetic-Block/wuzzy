variable "commit_sha" {
  type        = string
  description = "Git sha being deployed. Also selects the container image tag."
}

variable "release_tag" {
  type        = string
  description = "Release identifier. Live requires one; no v prefix."
  default     = "stage"
}

# The staging API at api-stage.wuzzy.io. Serves the metered /search, the free
# rate-limited /web-search, and the indexes routes.
#
# ADMIN_ENABLED stays false here. The admin surface is a separate job on a
# separate origin precisely so the public API is never a route to it.
job "wuzzy-api-stage" {
  datacenters = ["mb-hel"]
  type        = "service"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-api-stage-group" {
    count = 1

    network {
      mode = "bridge"
      port "http" {
        to = 3000
      }
    }

    task "wuzzy-api-stage-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-backend:sha-${var.commit_sha}"
        ports = ["http"]
      }

      env {
        PORT          = "3000"
        POSTGRES_DB   = "wuzzy"
        POSTGRES_USER = "wuzzy"

        # The meter is opt-out: absent config must not give the index away.
        X402_ENABLED          = "true"
        X402_NETWORK          = "base"
        X402_PRICE            = "$0.01"

        # Per page to commission an index. It buys the crawl, the embedding and
        # the onchain attestation together, so it has to cover gas: a receipt is
        # a bit over half a cent at the gas in SCHEMA.md. Set here rather than
        # left to the code default so the deployed price is visible in the spec.
        WUZZY_INDEX_PRICE_PER_PAGE = "$0.02"

        # The free box is opt-in, and the site calls it cross-origin because
        # Cloudflare Pages has no proxy in front of the static files.
        WEB_SEARCH_ENABLED     = "true"
        WEB_SEARCH_ORIGINS     = "https://stage.wuzzy.io"

        # MUST match the Cloudflare proxy setting on the api.wuzzy.io record.
        # Proxied, the chain is client -> Cloudflare -> Traefik, so the client
        # address is the SECOND entry from the right of X-Forwarded-For and this
        # is 2. DNS-only, it is 1. Getting it wrong is not a small error: the
        # rate limiter keys every request on Traefik's view of Cloudflare, so
        # every visitor on earth shares a single bucket and the free box stops
        # working for everyone after ten queries a minute.
        WEB_SEARCH_PROXY_HOPS  = "2"

        # Never on the public API. See apps/admin for the separate surface.
        ADMIN_ENABLED = "false"

        EAS_CHAIN   = "base"
        SEARCH_MODE = "hybrid"
      }

      template {
        data        = <<-EOT
        {{- range service "wuzzy-db" }}
        POSTGRES_HOST={{ .Address }}
        POSTGRES_PORT={{ .Port }}
        {{- end }}
        {{- /* The API only enqueues; workers drain. Without this a paid crawl
               waits for the sweeper instead of starting in seconds. */}}
        {{- range service "wuzzy-redis" }}
        REDIS_HOST={{ .Address }}
        REDIS_PORT={{ .Port }}
        {{- end }}
        {{- with secret "kv/wuzzy/api" }}
        {{- /* Coinbase settles Base mainnet; x402.org is testnet-only. */}}
        X402_CDP_API_KEY_ID={{ .Data.data.X402_CDP_API_KEY_ID }}
        X402_CDP_API_KEY_SECRET={{ .Data.data.X402_CDP_API_KEY_SECRET }}
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        EMBEDDING_API_KEY={{ .Data.data.EMBEDDING_API_KEY }}
        X402_PAY_TO={{ .Data.data.X402_PAY_TO }}
        EAS_SCHEMA_UID={{ .Data.data.EAS_SCHEMA_UID }}
        {{- end }}
        EOT
        destination = "secrets/api.env"
        env         = true
      }

      service {
        name = "wuzzy-api-stage"
        port = "http"

        tags = [
          "traefik.enable=true",
          "traefik.http.routers.wuzzy-api-stage.entrypoints=https",
          "traefik.http.routers.wuzzy-api-stage.tls=true",
          "traefik.http.routers.wuzzy-api-stage.tls.certresolver=memetic-block",
          "traefik.http.routers.wuzzy-api-stage.rule=Host(`api-stage.wuzzy.io`)",
          "traefik.http.routers.wuzzy-api-stage.priority=1",
        ]

        check {
          name     = "wuzzy-api-stage-http-check"
          type     = "http"
          path     = "/healthz"
          interval = "10s"
          timeout  = "5s"
        }
      }

      resources {
        cpu    = 2048
        memory = 2048
      }
    }
  }
}
