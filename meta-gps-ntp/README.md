# meta-gps-ntp

Custom Yocto layer for building a Raspberry Pi GPS-backed NTP server image.

## Provided pieces

- `gps-ntp-image`: custom image recipe
- `gpsd_%.bbappend`: sets gpsd defaults for serial GPS input
- `chrony_%.bbappend`: installs a chrony config for GPS + PPS time sources
- `gps-ntp-rpi.inc`: Raspberry Pi boot config defaults for UART and PPS GPIO

## Build target

Use `bitbake gps-ntp-image` after adding this layer to `bblayers.conf`
