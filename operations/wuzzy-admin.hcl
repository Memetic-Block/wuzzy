# The deployed version is written into this file rather than passed in: the
# cluster's Nomad does not support HCL2 variables. `operations/stamp-sha.sh`
# rewrites it across every spec at once, which is safer than editing them one
# at a time and ending up with a half-upgraded deployment.

# The operations view. Deliberately NOT on Cloudflare and NOT on wuzzy.io.
#
# Every other frontend here is static on Pages. This one is not, and the reason
# is the invariant: the admin surface has its own origin and image so it can be
# kept off the public internet. Putting it on Pages would make it public and
# leave the access decision to a Cloudflare Access rule, which is a control
# somebody can turn off by mistake. An internal hostname cannot be reached from
# outside the network at all.
#
# It carries its own backend, because the public API runs ADMIN_ENABLED=false
# and must keep doing so. That second instance is the only process in the
# deployment with the admin routes mounted.
job "wuzzy-admin" {
  datacenters = ["mb-hel"]
  type        = "service"

  constraint {
    attribute = "${meta.env}"
    value     = "store"
  }

  vault {
    policies = ["wuzzy-api"]
  }

  group "wuzzy-admin-group" {
    count = 1

    network {
      mode = "bridge"
      port "http" {
        to = 80
      }
      port "api" {
        to = 3000
      }
    }

    task "wuzzy-admin-api-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-backend:sha-2274da008707046fda203889be571f488c4994d0"
        ports = ["api"]
      }

      env {
        PORT          = "3000"
        POSTGRES_DB   = "wuzzy"
        POSTGRES_USER = "wuzzy"

        ADMIN_ENABLED = "true"

        # No public surface on this instance: no meter to run and no free box
        # to expose. It exists for /admin and nothing else.
        X402_ENABLED       = "false"
        WEB_SEARCH_ENABLED = "false"
      }

      template {
        data        = <<-EOT
        {{- range service "wuzzy-db" }}
        POSTGRES_HOST={{ .Address }}
        POSTGRES_PORT={{ .Port }}
        {{- end }}
        {{- with secret "kv/wuzzy/api" }}
        POSTGRES_PASSWORD={{ .Data.data.POSTGRES_PASSWORD }}
        ADMIN_TOKEN={{ .Data.data.ADMIN_TOKEN }}
        {{- end }}
        EOT
        destination = "secrets/admin-api.env"
        env         = true
      }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "wuzzy-admin-web-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-admin:sha-2274da008707046fda203889be571f488c4994d0"
        ports = ["http"]
      }

      env {
        BACKEND_ORIGIN = "http://127.0.0.1:3000"
      }

      service {
        name = "wuzzy-admin"
        port = "http"

        # Internal hostname. Traefik still terminates TLS, but this name does
        # not resolve outside the network.
        tags = [
          "traefik.enable=true",
          "traefik.http.routers.wuzzy-admin.entrypoints=https",
          "traefik.http.routers.wuzzy-admin.tls=true",
          "traefik.http.routers.wuzzy-admin.tls.certresolver=memetic-block",
          "traefik.http.routers.wuzzy-admin.rule=Host(`wuzzy-admin.hel.memeticblock.net`)",
        ]

        check {
          name     = "wuzzy-admin-tcp-check"
          type     = "tcp"
          interval = "10s"
          timeout  = "5s"
        }
      }

      resources {
        cpu    = 512
        memory = 512
      }
    }
  }
}
