# Servo firmware

Installs the experimental Robonine v9 firmware on GD32-based STS3215 servos (model bytes 9.3), or rolls back to Feetech factory firmware 3.10. USB serial only (the `robot.firmware` scope limits the connect dialog to USB).

## How it works

A port of [STS32XX-Firmware](https://github.com/roboninecom/STS32XX-Firmware) `tools/flash` (`bootloader.py`, `flash.py`, `settings.py`) to TypeScript, running inside the host's exclusive raw bus session (`context.bus.exclusive`):

- **Install**: servos are flashed one at a time by ID with the whole arm connected. The addressed reset is followed at once by a switch to 500 kbaud (the host closes and reopens the port), the bootloader handshake, and 64-byte blocks, each acknowledged. Afterwards the extension capabilities (`ARMC 9.0`) and unchanged settings are verified.
- **Backup**: the old firmware cannot be read back. The plugin makes the user download a settings backup (the 87-byte register table per servo) and select it again before installing. Nothing is stored server-side.
- **Rollback**: with only that servo on the bus, flash the factory image, then always restore the servo's own settings from the backup (factory startup may fall back to ID 1 and default calibration).
- **Recovery**: with only that servo on the bus, the port waits at 500 kbaud while the user power-cycles the servo.
- **Adapter echo**: half-duplex adapters that echo transmitted bytes are detected once per session, and each write consumes its own echo, so a block's echo is never mistaken for an ACK.

## Bundled releases

| Key | Release | SHA-256 | Source |
| --- | --- | --- | --- |
| `robonine-9.0` | `local-e44c0e6` | `71b406a2…a68e003` | `custom-v9-e44c0e6.zip`, STS32XX-Firmware release `v0.1-preview` (Apache-2.0) |
| `feetech-3.10` | `factory-3.10` | `1e267ff0…7256a35` | STS32XX-Firmware `tools/flash/factory/` (Feetech SCServo21-GD32-TTL 3.10) |

To add a release, extract the publisher's `release.json` + image into an empty folder and run:

```sh
node plugins/robonine/servo-firmware/scripts/embedRelease.mjs <folder>/release.json robonine-9-1
```

then list it in `src/releases/index.ts`. Size and SHA-256 are checked when embedding and again before every use.

## Tests

`npm test` (from `plugins/`) runs the flasher against a simulated bus: six servos, the bootloader protocol, an echoing adapter, a missed boot window, recovery through a power cycle and factory rollback with settings restore. Block framing is checked byte-for-byte against vectors produced by the Python `bootloader.py`.

**Not yet verified on hardware**: whether the browser's port reopen lands inside the servo's boot window, and whether the adapter echoes.
