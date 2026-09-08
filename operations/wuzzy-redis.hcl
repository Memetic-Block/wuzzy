# The broker for the crawl and attest queues.
#
# Deliberately without persistence: `--save ""` and no appendonly. The queue is
# a trigger and never the record. What is owed is in Postgres, as `index_urls`
# rows with a null `crawled_at` and as embedded documents carrying no
# attestation uid, and the sweepers re-enqueue from that. Persisting the queue
# would add a second, weaker copy of the truth and a restore path that could
# replay work already done.
#
# Losing this loses nothing except the current position, which is why it is the
# one piece of state here with no volume.
job "wuzzy-redis" {
  datacenters = ["mb-hel"]
  type        = "service"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  group "wuzzy-redis-group" {
    count = 1

    network {
      mode = "bridge"
      port "redis" {
        host_network = "wireguard"
      }
    }

    task "wuzzy-redis-task" {
      driver = "docker"

      config {
        image = "docker.io/library/redis:7-alpine"
        args = [
          "redis-server",
          "--port", "${NOMAD_PORT_redis}",
          "--save", "",
          "--appendonly", "no",
        ]
      }

      service {
        name = "wuzzy-redis"
        port = "redis"

        check {
          name     = "wuzzy-redis-tcp-check"
          type     = "tcp"
          interval = "10s"
          timeout  = "5s"
        }
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }
  }
}
