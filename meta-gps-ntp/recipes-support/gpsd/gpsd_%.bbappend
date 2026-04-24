FILESEXTRAPATHS_prepend := "${THISDIR}/files:"

SRC_URI += "file://gpsd.default file://gpsd.init"

do_install_append() {
    install -m 0644 ${WORKDIR}/gpsd.default ${D}${sysconfdir}/default/gpsd.default
    install -m 0755 ${WORKDIR}/gpsd.init ${D}${sysconfdir}/init.d/gpsd
}
