variable "commit_sha" {
  type        = string
  description = "Git sha whose migrations to apply. Also selects the image tag."
  # Defaulted so the job can be submitted from the Nomad UI with nothing to
  # fill in, which is how this one usually gets run. `latest` is only published
  # for default-branch builds, so pin the sha for anything other than deploying
  # the current tip of master: the schema this applies is the schema of the
  # image, not of whatever is already running.
  default = "latest"
}

locals {
  # CI publishes `sha-<full sha>` and `latest`, never a bare sha.
  image_tag = var.commit_sha == "latest" ? "latest" : "sha-${var.commit_sha}"
}

# Applies pending database migrations, then exits.
#
# This exists because there is no auto-migrate anywhere: `synchronize` is false
# in every environment, since TypeORM cannot model the vector extension, the
# hnsw index or the partial work-queue indexes and would drop them. Applying a
# migration is therefore always a deliberate act, and this is the deliberate
# act with a record of it in the job list.
#
# Run it against a database that is already up, before deploying the API that
# depends on the schema. It replaces the older dance of deploying the API first,
# letting its health check fail, and exec-ing into the allocation.
#
# Idempotent: TypeORM skips migrations already in the `migrations` table, so
# re-running it on an up-to-date database applies nothing and succeeds.
job "wuzzy-migrate" {
  datacenters = ["mb-hel"]
  type        = "batch"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-migrate-group" {
    count = 1

    # One shot. A migration that failed should be read before it is retried,
    # because the interesting failures here are a bad migration rather than a
    # flaky node, and rescheduling would bury the first error under a repeat.
    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 0
      mode     = "fail"
    }

    task "wuzzy-migrate-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-backend:${local.image_tag}"

        # Not `bun run migration:run`. Bun's workspace install hoists packages
        # to the repository root in the image, so the `apps/backend/node_modules`
        # that script's relative path expects does not exist there, and the
        # script fails with a module-not-found that looks nothing like a
        # migration problem. The CLI is invoked at the path it actually has.
        work_dir = "/app/apps/backend"
        command  = "bun"
        args = [
          "/app/node_modules/typeorm/cli.js",
          "-d", "src/database/data-source.ts",
          "migration:run",
        ]
      }

      env {
        POSTGRES_DB   = "wuzzy"
        POSTGRES_USER = "wuzzy"
      }

      template {
        data        = <<-EOT
        {{- range service "wuzzy-db" }}
        POSTGRES_HOST={{ .Address }}
        POSTGRES_PORT={{ .Port }}
        {{- end }}
        {{- with secret "kv/wuzzy/api" }}
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        {{- end }}
        EOT
        destination = "secrets/migrate.env"
        env         = true
      }

      resources {
        cpu    = 512
        memory = 512
      }
    }
  }
}
