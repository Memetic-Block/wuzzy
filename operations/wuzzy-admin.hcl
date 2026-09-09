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
# somebody can turn off by mistake.
#
# A hostname is not that control either, which this file learned the hard way:
# it used to route wuzzy-admin.hel.memeticblock.net through the public Traefik
# entrypoint and describe the name as internal. It resolves to the edge from
# anywhere. So there is no public route at all now, and the port binds to the
# private network the way the database and the broker do.
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
      # On the private network only, the same way wuzzy-db and wuzzy-redis are.
      # This is what "off the public internet" is made of: there is no route in
      # from outside, rather than a rule saying requests from outside are
      # refused.
      port "http" {
        to           = 80
        host_network = "wireguard"
      }
      port "api" {
        to = 3000
      }
    }

    task "wuzzy-admin-api-task" {
      driver = "docker"

      config {
        image = "ghcr.io/memetic-block/wuzzy-backend:sha-743669bc8de41420e46ca31b7178ceabebccb3fb"
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
        {{- /* `required` so a key missing from Vault fails the render instead
               of writing the string "<no value>" into the environment. An
               absent ADMIN_TOKEN would otherwise become the password, and an
               absent password would fail as a database error naming nothing. */}}
        POSTGRES_PASSWORD="{{ .Data.data.POSTGRES_PASSWORD }}"
        ADMIN_TOKEN="{{ .Data.data.ADMIN_TOKEN }}"
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
        image = "ghcr.io/memetic-block/wuzzy-admin:sha-743669bc8de41420e46ca31b7178ceabebccb3fb"
        ports = ["http"]
      }

      env {
        BACKEND_ORIGIN = "http://127.0.0.1:3000"
      }

      service {
        name = "wuzzy-admin"
        port = "http"

        # No Traefik. An earlier version of this file routed
        # wuzzy-admin.hel.memeticblock.net through the public entrypoint and
        # called the name internal; it resolves to the edge from anywhere, and
        # asking Let's Encrypt for a certificate publishes it in Certificate
        # Transparency logs, so it was neither private nor obscure. Reach this
        # over the private network instead:
        #
        #   nomad service info wuzzy-admin      # the address to open
        #
        # If it ever needs a hostname, it needs its own entrypoint bound to the
        # private interface, not a Host rule on the public one.

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
