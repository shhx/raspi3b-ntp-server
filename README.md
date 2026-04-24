# Raspberry Pi 3 GPS NTP Server (Yocto)

This workspace now includes a custom layer, `meta-gps-ntp`, with an image recipe for
a GPS-backed NTP server.

## Included custom image

- Image recipe: `gps-ntp-image`
- Time stack: `chrony` + `gpsd` + `pps-tools`
- Raspberry Pi settings: UART enabled and PPS GPIO overlay enabled

## Build

From the repo root:

```shell
source poky/oe-init-build-env build
bitbake gps-ntp-image
```

Output image example:

```shell
tmp/deploy/images/raspberrypi3/gps-ntp-image-raspberrypi3.wic.bz2
```

## Flash

```shell
bzcat tmp/deploy/images/raspberrypi3/gps-ntp-image-raspberrypi3.wic.bz2 | sudo dd of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

Replace `/dev/sdX` with your SD card device.
