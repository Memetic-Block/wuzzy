# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

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
        image = "ghcr.io/memetic-block/wuzzy-frontend-deploy:sha-c218113cfe70644a48bbc430ec046dddf670851d"
      }

      env {
        PROJECT_NAME  = "wuzzy-site-live"
        # MUST equal the Pages project's configured production branch, which is
        # `main` for wuzzy-site-live. Cloudflare decides production versus
        # preview by comparing this string to that setting, so a mismatch is not
        # an error: the deploy succeeds, reports a URL, and lands on a
        # *.pages.dev preview while wuzzy.io keeps serving whatever it had. It
        # is named for a git branch but nothing here has one; it is a label.
        PAGES_BRANCH  = "main"
        COMMIT_SHA    = "c218113cfe70644a48bbc430ec046dddf670851d"

        # Read by apps/frontend/src/site.config.ts while the pages render.
        SITE_ORIGIN     = "https://wuzzy.io"
        API_ORIGIN      = "https://api.wuzzy.io"
        WEB_SEARCH_URL  = "https://api.wuzzy.io/web-search"
        SEARCH_ENABLED  = "true"
        X402_NETWORK    = "base"
        X402_PRICE      = "$0.01"

        # Known at cutover, so the page states them rather than the "published
        # at cutover" placeholder it falls back to. The pay-to address is
        # already public in every 402 the API answers, and the schema is the
        # one registered on Base mainnet in block 51018240.
        X402_PAY_TO    = "0x0Deb462437ab46F703fcd15F9cf9c9Ea6472EAcB"
        EAS_SCHEMA_URL = "https://base.easscan.org/schema/view/0x15616641fbb8e7ee6a63f4904a622a154972e47453062c845845e1f2387f9f1a"
        # Still unpublished, so this one keeps the placeholder.
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
