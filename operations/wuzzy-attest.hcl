# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# Writes attestations to Base mainnet. RUN BY A HUMAN, ON PURPOSE.
#
# This is the one job here that spends money and signs with a funded key, so it
# is not periodic and never will be. It is submitted deliberately, watched, and
# it either completes or fails.
#
# The key lives in Vault and reaches the task as an environment variable
# rendered at run time. It is not in this repository, not in the image, and not
# on a developer machine, which is the invariant this job has to keep true.
#
# Idempotent and resumable: the work queue is `attestation_uid IS NULL`, and
# backfill happens per batch, so an interrupted run resumes where it stopped and
# never double-attests. Re-running after a partial failure is safe and is the
# intended recovery.
#
# Cost, estimated against live Base mainnet: 332,346 gas per attestation at the
# default batch of 50, which is 92 transactions and about 0.017 ETH for a
# 4555-document corpus at 0.011 gwei. Unbatched it is 388k each, so batching is
# worth roughly 14%; past a batch of 25 it buys nothing. Fund the attester with
# headroom, because the corpus grows and the base fee moves. See SCHEMA.md.
job "wuzzy-attest" {
  datacenters = ["mb-hel"]
  type        = "batch"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  reschedule {
    attempts = 0
  }

  vault {
    # Both, because the templates below read both paths: the schema uid and the
    # database password from kv/wuzzy/api, the funded key from
    # kv/wuzzy/attester. Declaring only one renders an empty value into the
    # environment and the job fails on a missing variable at start.
    policies = ["wuzzy-api", "wuzzy-attester"]
  }

  group "wuzzy-attest-group" {
    count = 1

    task "wuzzy-attest-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/memetic-block/wuzzy-backend:sha-577fd65513a56310c10de508e4bcc199b2250f5a"
        entrypoint = ["/bin/sh", "-c"]
        args       = ["bun apps/backend/src/cli/wuzzy.ts attest"]
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
        {{- with secret "kv/wuzzy/api" }}
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        EAS_SCHEMA_UID={{ .Data.data.EAS_SCHEMA_UID }}
        {{- end }}
        {{- with secret "kv/wuzzy/attester" }}
        ATTESTER_PRIVATE_KEY={{ .Data.data.ATTESTER_PRIVATE_KEY }}
        {{- end }}
        EOT
        destination = "secrets/attest.env"
        env         = true
      }

      restart {
        attempts = 0
        mode     = "fail"
      }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }
  }
}
