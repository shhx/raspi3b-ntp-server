SUMMARY = "Lightweight web status for chrony, gpsd, and NTP server"
DESCRIPTION = "Small Python HTTP service exposing real-time status of chrony and gpsd"
HOMEPAGE = "https://example.local/ntp-status-web"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://ntp-status-web.py \
    file://ntp-status-web.init \
    file://ntp-status-web.service \
    file://index.html \
    file://styles.css \
    file://app.js \
"

S = "${WORKDIR}"

inherit allarch update-rc.d systemd

RDEPENDS:${PN} = " \
    python3-core \
    python3-html \
    python3-netserver \
    chrony \
    gpsd \
    gps-utils \
"

INITSCRIPT_PACKAGES = "${PN}"
INITSCRIPT_NAME:${PN} = "ntp-status-web"
INITSCRIPT_PARAMS:${PN} = "defaults 95"

SYSTEMD_PACKAGES = "${PN}"
SYSTEMD_SERVICE:${PN} = "ntp-status-web.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${bindir}
    install -d ${D}${sysconfdir}/init.d
    install -d ${D}${systemd_system_unitdir}
    install -d ${D}${datadir}/ntp-status-web

    install -m 0755 ${WORKDIR}/ntp-status-web.py ${D}${bindir}/ntp-status-web
    install -m 0755 ${WORKDIR}/ntp-status-web.init ${D}${sysconfdir}/init.d/ntp-status-web
    install -m 0644 ${WORKDIR}/ntp-status-web.service ${D}${systemd_system_unitdir}/ntp-status-web.service
    install -m 0644 ${WORKDIR}/index.html ${D}${datadir}/ntp-status-web/index.html
    install -m 0644 ${WORKDIR}/styles.css ${D}${datadir}/ntp-status-web/styles.css
    install -m 0644 ${WORKDIR}/app.js ${D}${datadir}/ntp-status-web/app.js
}

FILES:${PN} += "${systemd_system_unitdir}/ntp-status-web.service ${datadir}/ntp-status-web/*"
