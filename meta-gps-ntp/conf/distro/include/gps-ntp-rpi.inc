# Enable primary UART for NMEA from GPS receiver. We do not want to use it as console, so dont use ENABLE_UART
ENABLE_UART = "0"
RPI_EXTRA_CONFIG_append = "\nenable_uart=1\n"

# Disable Bluetooth to free up UART for GPS.
RPI_EXTRA_CONFIG_append = "\ndtoverlay=disable-bt\n"

# Configure PPS capture on GPIO18 (pin 12).
RPI_EXTRA_CONFIG_append = "\ndtoverlay=pps-gpio,gpiopin=18\n"
