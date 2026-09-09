# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# Writes the onchain receipts. The only long-running job that spends money.
#
# **count = 1, and it is not a tuning knob.** Every batch is a transaction from
# one funded account, so a second attester would build against the same nonce
# and throw away a transaction it had already paid for. Throughput comes from a
# larger multiAttest batch, not from more of these.
#
# It holds the funded key, which is why it is a separate job from the crawl
# workers: those scale freely and must never carry one. The key reaches the task
# from Vault at run time, so it is not in this repository, not in the image, and
# not on a developer machine.
#
# What it costs: 327,329 gas per attestation at a batch of 50 (see SCHEMA.md).
# At Base around 0.006 gwei that is roughly half a US cent a page, which is what
# WUZZY_INDEX_PRICE_PER_PAGE is set to cover. Watch the attester's balance the
# way you would watch disk: it fails closed, but a run that dies out of gas is
# only recoverable by funding it again.
#
# Attesting the global index is included, not excluded. The sweeper's work queue
# is any embedded document with no uid, and global's pages qualify, so deploying
# this starts attesting the free corpus at operator expense. That is deliberate:
# an unattested global index makes the site's central claim untrue.
job "wuzzy-attester" {
  datacenters = ["mb-hel"]
  type        = "service"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api", "wuzzy-attester"]
  }

  group "wuzzy-attester-group" {
    # See above. Raising this does not go faster, it wastes gas.
    count = 1

    network {
      mode = "bridge"
    }

    task "wuzzy-attester-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-170aa22e9797ee11416847e4a6ea857a720f2273"
        entrypoint = ["/bin/sh", "-c"]
        args       = ["bun apps/backend/src/attester.ts"]
      }

      env {
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
        EAS_SCHEMA_UID={{ .Data.data.EAS_SCHEMA_UID }}
        {{- end }}
        {{- with secret "kv/wuzzy/attester" }}
        ATTESTER_PRIVATE_KEY={{ .Data.data.ATTESTER_PRIVATE_KEY }}
        {{- end }}
        EOT
        destination = "secrets/attester.env"
        env         = true
      }

      # A batch is in flight for as long as Base takes to include it. Killing
      # mid-batch does not lose money, because the work queue is documents with
      # no uid and a re-run re-queries it, but it can leave gas spent on a
      # transaction whose result nobody waited for.
      kill_timeout = "2m"

      resources {
        cpu    = 512
        memory = 1024
      }
    }
  }
}
