variable "commit_sha" {
  type        = string
  description = "Git sha being deployed. Also selects the container image tag."
}

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
# Cost, measured against forked Base mainnet: 388,188 gas per attestation, about
# $26 for a 4555-document corpus at 0.006 gwei. See SCHEMA.md.
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
    policies = ["wuzzy-attester"]
  }

  group "wuzzy-attest-group" {
    count = 1

    task "wuzzy-attest-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/memetic-block/wuzzy-backend:${var.commit_sha}"
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
