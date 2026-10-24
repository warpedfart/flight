# Deployment helpers

`update.sh` fetches the configured branch, fast-forwards only, validates changed
JavaScript, and restarts the server only when a loaded server file changed. It
runs as root, but uses `FLIGHT_USER` for Git operations.

## systemd

The existing `flight-update.service` and `flight-update.timer` check for an
update every two minutes.

## OpenRC

The OpenRC service keeps a small foreground loop alive and runs the same
updater every two minutes. It does not require cron.

```sh
install -m 755 deploy/flight-update.openrc /etc/init.d/flight-update
install -m 644 deploy/flight-update.conf /etc/conf.d/flight-update
rc-update add flight-update default
rc-service flight-update start
```

Uncomment and change values in `/etc/conf.d/flight-update` when the server is
not installed at `/home/aj/ajc-private-server`, runs as a different user, or
uses a differently named OpenRC service. `FLIGHT_UPDATE_INTERVAL` is a positive
number of seconds and defaults to `120`.

`update.sh` selects OpenRC automatically when run by OpenRC. Set
`FLIGHT_INIT=openrc` when running it manually or from another supervisor. Set
`FLIGHT_INIT=systemd` to force systemd.
