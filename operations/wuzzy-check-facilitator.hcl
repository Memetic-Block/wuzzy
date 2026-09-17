# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# Asks the facilitator whether it can settle what the API quotes, then exits.
#
# Every 402 offers x402 version 1 and version 2, so this passes only when the
# facilitator settles an `exact` payment in both, on the network the API meters
# on. A version it cannot settle is a payer who signs and is then turned away,
# and wrong credentials look exactly the same from the payer's side.
#
# A batch job rather than a shell in the API's allocation because the
# credentials live in Vault, and this reads them the way the API does without
# anyone holding a token to exec with. The verdict is the job's status and the
# detail is its log. Submit it from the UI before deploying an API that quotes
# prices, and again whenever the facilitator or its credentials change.
job "wuzzy-check-facilitator" {
  datacenters = ["mb-hel"]
  type        = "batch"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-check-facilitator-group" {
    count = 1

    # One shot. A failure here is an answer, not a flaky node, and a retry
    # would only print the same answer again.
    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 0
      mode     = "fail"
    }

    task "wuzzy-check-facilitator-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-backend:sha-368bc7d6bb996353feb207a3d6071e6feedaa9fc"

        work_dir = "/app"
        command  = "bun"
        args     = ["apps/backend/src/cli/check-facilitator.ts"]
      }

      env {
        # Must match the API specs, or this checks a network nobody is quoted.
        # The facilitator URL is left unset for the same reason: the API uses
        # the default, which is Coinbase's.
        X402_NETWORK = "base"
      }

      template {
        data        = <<-EOT
        {{- with secret "kv/wuzzy/api" }}
        X402_CDP_API_KEY_ID={{ .Data.data.X402_CDP_API_KEY_ID }}
        X402_CDP_API_KEY_SECRET={{ .Data.data.X402_CDP_API_KEY_SECRET }}
        {{- end }}
        EOT
        destination = "secrets/facilitator.env"
        env         = true
      }

      resources {
        cpu    = 256
        memory = 512
      }
    }
  }
}
