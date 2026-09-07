variable "commit_sha" {
  type        = string
  description = "Git sha being deployed. Also selects the container image tag."
}

variable "commit_timestamp" {
  type        = string
  description = "Commit time, ISO 8601 UTC."
}

variable "release_tag" {
  type        = string
  description = "Release identifier. Live requires one; no v prefix."
}

# The public site. Static HTML rendered at deploy time and pushed to Cloudflare
# Pages, so nothing of ours serves wuzzy.io.
#
# Consequence worth stating: there is no nginx in front of these files, so the
# /api proxy the container image provides does not exist here. The free search
# box therefore calls the API cross-origin, which is why WEB_SEARCH_URL is set
# below and why the API's WEB_SEARCH_ORIGINS has to name this site.
job "wuzzy-frontend-static-live" {
  datacenters = ["mb-hel"]
  type        = "batch"

  constraint {
    attribute = "${meta.env}"
    value     = "edge-worker"
  }

  reschedule {
    attempts = 0
  }

  group "wuzzy-frontend-static-live-group" {
    count = 1

    task "wuzzy-frontend-static-live-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-frontend-deploy:${var.commit_sha}"
      }

      env {
        PROJECT_NAME  = "wuzzy-site-live"
        PAGES_BRANCH  = "live"
        COMMIT_SHA    = "${var.commit_sha}"

        # Read by apps/frontend/src/site.config.ts while the pages render.
        SITE_ORIGIN     = "https://wuzzy.io"
        API_ORIGIN      = "https://api.wuzzy.io"
        WEB_SEARCH_URL  = "https://api.wuzzy.io/web-search"
        SEARCH_ENABLED  = "true"
        X402_NETWORK    = "base"
        X402_PRICE      = "$0.01"

        # Absent values render as a stated "published at cutover" note rather
        # than a dead link, so the page is complete before these exist.
        # X402_PAY_TO    = ""
        # EAS_SCHEMA_URL = "https://base.easscan.org/schema/view/0x2677bbe3712340b96468584bb861dc14bdacd3fd16470f5b4966461127a503ab"
        # BAZAAR_URL     = ""
      }

      vault {
        policies = ["memeticblock-io-cloudflare-deployer"]
      }

      template {
        data        = <<-EOT
        {{- with secret "kv/memeticblock/cloudflare-deployer" }}
        CLOUDFLARE_ACCOUNT_ID={{ .Data.data.CLOUDFLARE_ACCOUNT_ID }}
        CLOUDFLARE_API_TOKEN={{ .Data.data.CLOUDFLARE_API_TOKEN }}
        {{- end }}
        EOT
        destination = "secrets/cloudflare.env"
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
