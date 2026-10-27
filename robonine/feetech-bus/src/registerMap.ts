// Sources used to verify this register map:
// - Official Feetech Arduino SDK (SMS_STS.h / SMS_STS.cpp): https://github.com/ftservo/FTServo_Arduino
// - matthieuvigne/STS_servos (most complete named register set): https://github.com/matthieuvigne/STS_servos/blob/master/src/STSServoDriver.h
// - huggingface/lerobot feetech tables (sign-magnitude encodings, addr 80–86 names): https://github.com/huggingface/lerobot/blob/v0.6.1/src/lerobot/motors/feetech/tables.py
// - AIFITLAB STS memory table analysis (addr 24/25 split, factory params 80–86): https://wiki.aifitlab.com/feetech-servo-motor-docs/feetech-sts-servo-memory-table-analysis
// - ABEJA SO-101 motor control post (lerobot ↔ Feetech FD tool name mapping): https://tech-blog.abeja.asia/entry/so101-motor-control-202508
// - commanderfun/STS3215 register reference (defaults, units): https://github.com/commanderfun/STS3215/blob/main/REGISTER_REFERENCE.md
// - iotdesignshop/Feetech-tuna (real-world Phase register values): https://github.com/iotdesignshop/Feetech-tuna/blob/main/servotemplates.py
// - dgmz/feetech-servo-tool (cross-model ranges): https://github.com/dgmz/feetech-servo-tool/blob/main/servo.py
// - Waveshare ST3215 user manual: https://files.waveshare.com/upload/f/f4/ST3215_Servo_User_Manual.pdf

export type RegisterAccess = 'R' | 'RW'
export type RegisterArea = 'EEPROM' | 'RAM' | 'FACTORY'

export interface StsRegister {
  addr: number
  name: string
  bytes: number
  access: RegisterAccess
  area: RegisterArea
  defaultVal: string
  range: string
  description: string
}

/** Lock register address — must be written 0 before any EEPROM write, then 1 after. */
export const ADDR_LOCK = 55
/** Total EEPROM block size to read in one shot (addr 0–39). */
export const EEPROM_BLOCK_LEN = 40
/** Total RAM block size to read in one shot (addr 40–70, Present Current is 2 bytes at 69). */
export const RAM_BLOCK_LEN = 31
/** RAM start address. */
export const RAM_START = 40
/** Factory parameter block start address (shown as the DEFAULT area in Feetech FD). */
export const FACTORY_START = 80
/** Factory parameter block size (addr 80–86). */
export const FACTORY_BLOCK_LEN = 7

export const REGISTER_MAP: StsRegister[] = [
  // ── EEPROM ──────────────────────────────────────────────────────────────
  { addr: 0, name: 'Firmware Major', bytes: 1, access: 'R', area: 'EEPROM', defaultVal: '—', range: '—', description: 'Major firmware version number' },
  { addr: 1, name: 'Firmware Minor', bytes: 1, access: 'R', area: 'EEPROM', defaultVal: '—', range: '—', description: 'Minor firmware version number' },
  { addr: 3, name: 'Servo Major', bytes: 1, access: 'R', area: 'EEPROM', defaultVal: '—', range: '—', description: 'Servo series major version' },
  { addr: 4, name: 'Servo Minor', bytes: 1, access: 'R', area: 'EEPROM', defaultVal: '—', range: '—', description: 'Servo series minor version' },
  { addr: 5, name: 'ID', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '1', range: '0–253', description: 'Bus servo ID. 254 (0xFE) is broadcast. Unlock EEPROM before changing.' },
  { addr: 6, name: 'Baud Rate', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '0', range: '0–7', description: '0=1Mbps, 1=500K, 2=250K, 3=128K, 4=115200, 5=76800, 6=57600, 7=38400' },
  { addr: 7, name: 'Return Delay', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '0', range: '0–254 µs', description: 'Delay in µs before servo responds to a packet' },
  { addr: 8, name: 'Response Level', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '1', range: '0–2', description: '0=no response, 1=respond to READ only, 2=respond to all instructions' },
  {
    addr: 9,
    name: 'Min Angle Limit',
    bytes: 2,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '0',
    range: '0–4095',
    description: 'Minimum allowed position. Set both limits to 0 to enable continuous wheel mode.',
  },
  { addr: 11, name: 'Max Angle Limit', bytes: 2, access: 'RW', area: 'EEPROM', defaultVal: '4095', range: '0–4095', description: 'Maximum allowed position.' },
  { addr: 13, name: 'Max Temp Limit', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '70', range: '0–100 °C', description: 'Over-temperature threshold. Torque is cut when this is exceeded.' },
  { addr: 14, name: 'Max Voltage Limit', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '140', range: '0–255 (×0.1 V)', description: 'Over-voltage threshold (140 = 14.0 V)' },
  { addr: 15, name: 'Min Voltage Limit', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '50', range: '0–255 (×0.1 V)', description: 'Under-voltage threshold (50 = 5.0 V)' },
  {
    addr: 16,
    name: 'Max Torque Limit',
    bytes: 2,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '1000',
    range: '0–1000',
    description: 'Maximum torque as PWM duty ×10 (1000 = 100%). Copied to RAM Torque Limit on power-on.',
  },
  {
    addr: 18,
    name: 'Phase',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '—',
    range: 'bitmask',
    description: 'Motor phase config (hardware-specific). Bit0=direction (0=normal, 1=reversed), bit4=multi-turn mode. Factory value varies by unit.',
  },
  {
    addr: 19,
    name: 'Unload Condition',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '37',
    range: 'bitmask',
    description: 'Conditions that disable torque: bit0=voltage, bit1=sensor, bit2=temperature, bit3=current, bit4=angle limit, bit5=overload',
  },
  {
    addr: 20,
    name: 'LED Alarm',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '37',
    range: 'bitmask',
    description: 'Conditions that blink the status LED: bit0=voltage, bit1=sensor, bit2=temperature, bit3=current, bit4=angle limit, bit5=overload',
  },
  { addr: 21, name: 'P Coefficient', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '32', range: '0–255', description: 'PID proportional gain (position loop)' },
  { addr: 22, name: 'D Coefficient', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '32', range: '0–255', description: 'PID derivative gain' },
  { addr: 23, name: 'I Coefficient', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '0', range: '0–255', description: 'PID integral gain' },
  {
    addr: 24,
    name: 'Min Startup Force',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '0',
    range: '0–254 (×0.1 %)',
    description: 'Minimum motor output to overcome static friction before PID takes over ("Punch" in Feetech FD). Shared by both directions.',
  },
  {
    addr: 25,
    name: 'Integral Limit',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '0',
    range: '0–254',
    description: 'Caps the position-loop integral term at value × 4 ("MAX I" in Feetech FD). 0 = no cap. Applies in modes 0 and 4.',
  },
  { addr: 26, name: 'CW Dead Zone', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '1', range: '0–255', description: 'Clockwise position insensitive dead zone in encoder counts' },
  { addr: 27, name: 'CCW Dead Zone', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '1', range: '0–255', description: 'Counter-clockwise position insensitive dead zone in encoder counts' },
  { addr: 28, name: 'Protection Current', bytes: 2, access: 'RW', area: 'EEPROM', defaultVal: '0', range: '0–2047 (×6.5 mA)', description: 'Overcurrent protection threshold. Max effective value 500 (3250 mA).' },
  {
    addr: 30,
    name: 'Angular Resolution',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '1',
    range: '1–100',
    description: 'Multi-turn resolution multiplier. 1 = one full rotation max range (±2048 counts).',
  },
  {
    addr: 31,
    name: 'Position Offset',
    bytes: 2,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '0',
    range: '−2047–2047',
    description: 'Zero-point calibration offset (sign-magnitude encoding, bit11 = sign)',
  },
  { addr: 33, name: 'Mode', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '0', range: '0–3', description: '0=servo position, 1=speed closed-loop, 2=speed open-loop (PWM), 3=step mode' },
  {
    addr: 34,
    name: 'Protection Torque',
    bytes: 1,
    access: 'RW',
    area: 'EEPROM',
    defaultVal: '20',
    range: '0–100 %',
    description: 'Torque output level during overload protection, as % of max torque',
  },
  { addr: 35, name: 'Protection Time', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '200', range: '0–254 (×40 ms)', description: 'Duration before overload protection triggers' },
  { addr: 36, name: 'Overload Torque', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '80', range: '0–100 %', description: 'Load threshold (% of max torque) that triggers overload protection' },
  { addr: 37, name: 'Speed P Gain', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '—', range: '0–255', description: 'Proportional gain for speed closed-loop control (Mode 1)' },
  { addr: 38, name: 'Overcurrent Time', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '—', range: '0–254 (×40 ms)', description: 'Duration before overcurrent protection triggers' },
  { addr: 39, name: 'Speed I Gain', bytes: 1, access: 'RW', area: 'EEPROM', defaultVal: '—', range: '0–255', description: 'Integral gain for speed closed-loop control (Mode 1)' },
  // ── RAM ─────────────────────────────────────────────────────────────────
  {
    addr: 40,
    name: 'Torque Enable',
    bytes: 1,
    access: 'RW',
    area: 'RAM',
    defaultVal: '0',
    range: '0–1, 128',
    description: '0=off (limp), 1=on. Writing 128 sets current shaft position as the midpoint (2048).',
  },
  { addr: 41, name: 'Acceleration', bytes: 1, access: 'RW', area: 'RAM', defaultVal: '0', range: '0–254', description: 'Acceleration ramp (0=instant). Unit ≈ 100 encoder steps/s².' },
  {
    addr: 42,
    name: 'Goal Position',
    bytes: 2,
    access: 'RW',
    area: 'RAM',
    defaultVal: '—',
    range: '0–4095',
    description: 'Target position. In motor modes the value encodes speed (bit15 = direction). In step mode: step count.',
  },
  { addr: 44, name: 'Goal Time', bytes: 2, access: 'RW', area: 'RAM', defaultVal: '0', range: '0–65535 ms', description: 'Time to reach goal position in ms. 0 = use Goal Speed instead.' },
  { addr: 46, name: 'Goal Speed', bytes: 2, access: 'RW', area: 'RAM', defaultVal: '0', range: '0–4095', description: 'Speed limit for movement (0 = maximum). In motor mode: rpm target.' },
  { addr: 48, name: 'Torque Limit', bytes: 2, access: 'RW', area: 'RAM', defaultVal: '1000', range: '0–1000', description: 'Runtime torque limit. Copied from Max Torque Limit on power-on.' },
  {
    addr: 55,
    name: 'Lock',
    bytes: 1,
    access: 'RW',
    area: 'RAM',
    defaultVal: '1',
    range: '0–1',
    description: 'EEPROM write-protect: 1=locked (default on boot), 0=unlocked. Must write 0 before any EEPROM write.',
  },
  { addr: 56, name: 'Present Position', bytes: 2, access: 'R', area: 'RAM', defaultVal: '—', range: '0–4095', description: 'Current shaft position in encoder counts' },
  { addr: 58, name: 'Present Speed', bytes: 2, access: 'R', area: 'RAM', defaultVal: '—', range: '±4095', description: 'Current movement speed. Bit15 = direction flag.' },
  {
    addr: 60,
    name: 'Present Load',
    bytes: 2,
    access: 'R',
    area: 'RAM',
    defaultVal: '—',
    range: '0–1023 + dir bit',
    description: 'Current motor load/torque. Bits 0–9 = magnitude (0–1000 scale). Bit10 = direction.',
  },
  { addr: 62, name: 'Present Voltage', bytes: 1, access: 'R', area: 'RAM', defaultVal: '—', range: '0–255 (×0.1 V)', description: 'Input supply voltage (74 = 7.4 V)' },
  { addr: 63, name: 'Present Temperature', bytes: 1, access: 'R', area: 'RAM', defaultVal: '—', range: '0–100 °C', description: 'Internal temperature in degrees Celsius' },
  {
    addr: 64,
    name: 'Async Write Flag',
    bytes: 1,
    access: 'R',
    area: 'RAM',
    defaultVal: '0',
    range: '0–1',
    description: '1 = a REG WRITE command is buffered, waiting for an ACTION instruction to execute it',
  },
  {
    addr: 65,
    name: 'Servo Status',
    bytes: 1,
    access: 'R',
    area: 'RAM',
    defaultVal: '0',
    range: 'bitmask',
    description: 'Error/fault bitmask: bit0=voltage, bit1=sensor, bit2=temperature, bit3=current, bit5=overload. 0 = no errors.',
  },
  { addr: 66, name: 'Moving', bytes: 1, access: 'R', area: 'RAM', defaultVal: '0', range: '0–1', description: '1 = servo is actively moving toward the goal position' },
  { addr: 69, name: 'Present Current', bytes: 2, access: 'R', area: 'RAM', defaultVal: '—', range: '0–511 (×6.5 mA)', description: 'Current draw in 6.5 mA units' },
  // ── Factory parameters (read-only, set at the factory) ─────────────────
  {
    addr: 80,
    name: 'Moving Threshold',
    bytes: 1,
    access: 'R',
    area: 'FACTORY',
    defaultVal: '—',
    range: '0–255',
    description: 'Speed threshold above which the servo reports itself as moving (drives the Moving flag at 66).',
  },
  { addr: 81, name: 'DTs', bytes: 1, access: 'R', area: 'FACTORY', defaultVal: '—', range: '0–255 ms', description: 'Internal control-loop timing period in ms.' },
  {
    addr: 82,
    name: 'Velocity Unit Factor',
    bytes: 1,
    access: 'R',
    area: 'FACTORY',
    defaultVal: '—',
    range: '0–255',
    description: 'Scale for velocity unit conversion ("Vk" in Feetech FD). On STS3215 it is 50, so one Vmin/Vmax unit is 50 steps/s ≈ 0.732 rpm.',
  },
  {
    addr: 83,
    name: 'Min Velocity Limit',
    bytes: 1,
    access: 'R',
    area: 'FACTORY',
    defaultVal: '—',
    range: '0–255 (×0.732 rpm)',
    description: 'Minimum allowed speed ("Vmin" in Feetech FD). LeRobot calls this register Hts (ns), valid from firmware 2.54.',
  },
  { addr: 84, name: 'Max Velocity Limit', bytes: 1, access: 'R', area: 'FACTORY', defaultVal: '—', range: '0–255 (×0.732 rpm)', description: 'Maximum allowed speed ("Vmax" in Feetech FD).' },
  { addr: 85, name: 'Max Acceleration', bytes: 1, access: 'R', area: 'FACTORY', defaultVal: '—', range: '0–255', description: 'Factory-set maximum acceleration ("Amax" in Feetech FD).' },
  {
    addr: 86,
    name: 'Acceleration Multiplier',
    bytes: 1,
    access: 'R',
    area: 'FACTORY',
    defaultVal: '—',
    range: '0–255',
    description: 'Acceleration used when Acceleration (41) is 0 ("KAcc" in Feetech FD). If both are 0 the servo responds at full speed.',
  },
]

/** Decode a raw byte array (starting at addr 0) into a map of addr → numeric value. */
export function decodeRegisters(raw: number[]): Record<number, number> {
  const values: Record<number, number> = {}

  for (const reg of REGISTER_MAP) {
    const lo = raw[reg.addr]

    if (lo === undefined) {
      continue
    }
    if (reg.bytes === 1) {
      values[reg.addr] = lo
    } else {
      const hi = raw[reg.addr + 1] ?? 0

      values[reg.addr] = lo | (hi << 8)
    }
  }

  return values
}
