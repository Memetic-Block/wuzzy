# Postgres with pgvector, the only stateful thing Wuzzy has.
#
# pgvector rather than stock postgres is not a preference: the migrations create
# the `vector` extension and an hnsw index, and neither exists in the base image.
# `synchronize` is false in every environment, so the schema only ever moves
# through migrations run deliberately.
job "wuzzy-db" {
  datacenters = ["mb-hel"]
  type        = "service"

  # Stateful work lives on the Helsinki bare-metal box.
  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-db-group" {
    count = 1

    network {
      mode = "bridge"
      port "postgres" {
        host_network = "wireguard"
      }
    }

    volume "wuzzy-db" {
      type      = "host"
      read_only = false
      source    = "wuzzy-db"
    }

    task "wuzzy-db-task" {
      driver = "docker"

      config {
        image = "docker.io/pgvector/pgvector:pg16"
        args = [
          "-c", "listen_addresses=*",
          # The corpus is read-heavy and the vector arm scans; give it room.
          "-c", "shared_buffers=1GB",
          "-c", "work_mem=64MB",
        ]
      }

      volume_mount {
        volume      = "wuzzy-db"
        destination = "/var/lib/postgresql/data"
        read_only   = false
      }

      env {
        POSTGRES_DB   = "wuzzy"
        POSTGRES_USER = "wuzzy"
        PGPORT        = "${NOMAD_PORT_postgres}"
      }

      template {
        data        = <<-EOT
        {{- with secret "kv/wuzzy/api" }}
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        {{- end }}
        EOT
        destination = "secrets/db.env"
        env         = true
      }

      service {
        name = "wuzzy-db"
        port = "postgres"

        check {
          name     = "wuzzy-db-tcp-check"
          type     = "tcp"
          interval = "10s"
          timeout  = "5s"
        }
      }

      resources {
        cpu    = 2048
        memory = 4096
      }
    }
  }
}
