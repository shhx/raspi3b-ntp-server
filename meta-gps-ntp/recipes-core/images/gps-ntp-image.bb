SUMMARY = "Raspberry Pi GPS-backed NTP server image"
LICENSE = "MIT"

inherit core-image

IMAGE_FEATURES += "ssh-server-openssh"

IMAGE_INSTALL_append = " \
    chrony \
    chronyc \
    gpsd \
    gpsd-conf \
    gpsd-udev \
    gpsd-gpsctl \
    gps-utils \
    pps-tools \
    kernel-modules \
    util-linux \
    vim-tiny \
    procps \
"
