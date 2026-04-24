# meta-gps-ntp

Custom Yocto layer for building a Raspberry Pi GPS-backed NTP server image.

## Provided pieces

- `gps-ntp-image`: custom image recipe
- `gpsd_%.bbappend`: sets gpsd defaults for serial GPS input
- `chrony_%.bbappend`: installs a chrony config for GPS + PPS time sources
- `gps-ntp-rpi.inc`: Raspberry Pi boot config defaults for UART and PPS GPIO
- `ntp-status-web`: lightweight web UI with real-time chrony/gpsd/NTP status

## Build target

Use `bitbake gps-ntp-image` after adding this layer to `bblayers.conf`

## Runtime status web page

After boot, a status page is available at:

- `http://<target-ip>/`

The page auto-refreshes every 2 seconds and shows:

- chrony daemon status + `chronyc tracking`
- gpsd daemon status + latest GPS TPV fix data
- NTP server listening status (UDP port 123)
