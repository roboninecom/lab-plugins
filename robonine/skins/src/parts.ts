import type { LocaleText } from './filaments'
import type { RobotPartInfo } from './worldViewParts'

/** Body regions a skin paints; every printed part belongs to exactly one. */
export const ZONES = ['base', 'shoulder', 'upperArm', 'forearm', 'wrist', 'gripper'] as const

export type Zone = (typeof ZONES)[number]

/**
 * plastic     — a printed part: the user prints it in the skin's filament.
 * motor       — a bought STS3215 servo, stays its factory black.
 * electronics — a bought board or camera, stays as modelled.
 * combined    — printed parts and motors merged into one mesh by the CAD export
 *               (SO-ARM102), so the whole link takes the plastic colour.
 */
export type PartKind = 'plastic' | 'motor' | 'electronics' | 'combined'

export interface ClassifiedPart extends RobotPartInfo {
  kind: PartKind
  zone: Zone
  label: LocaleText
}

interface CatalogEntry {
  kind: PartKind
  zone: Zone
  label: LocaleText
}

/**
 * What each mesh of the supported arms is. Keyed by mesh file name, which is
 * shared between models (so-arm101 and so-arm101-robonine use the same STLs).
 */
const CATALOG: Record<string, CatalogEntry> = {
  // SO-ARM101 printed parts
  base_so101_v2: { kind: 'plastic', zone: 'base', label: { en: 'Base', ru: 'Основание' } },
  base_motor_holder_so101_v1: { kind: 'plastic', zone: 'base', label: { en: 'Base motor holder', ru: 'Держатель мотора основания' } },
  waveshare_mounting_plate_so101_v2: { kind: 'plastic', zone: 'base', label: { en: 'Driver board plate', ru: 'Площадка платы драйвера' } },
  motor_holder_so101_base_v1: { kind: 'plastic', zone: 'shoulder', label: { en: 'Shoulder motor holder', ru: 'Держатель мотора плеча' } },
  rotation_pitch_so101_v1: { kind: 'plastic', zone: 'shoulder', label: { en: 'Shoulder bracket', ru: 'Кронштейн плеча' } },
  upper_arm_so101_v1: { kind: 'plastic', zone: 'upperArm', label: { en: 'Upper arm', ru: 'Плечевое звено' } },
  under_arm_so101_v1: { kind: 'plastic', zone: 'forearm', label: { en: 'Forearm', ru: 'Предплечье' } },
  motor_holder_so101_wrist_v1: { kind: 'plastic', zone: 'forearm', label: { en: 'Wrist motor holder', ru: 'Держатель мотора запястья' } },
  wrist_roll_pitch_so101_v2: { kind: 'plastic', zone: 'wrist', label: { en: 'Wrist', ru: 'Запястье' } },
  wrist_roll_follower_so101_v1: { kind: 'plastic', zone: 'gripper', label: { en: 'Fixed jaw', ru: 'Неподвижная губка' } },
  moving_jaw_so101_v1: { kind: 'plastic', zone: 'gripper', label: { en: 'Moving jaw', ru: 'Подвижная губка' } },
  // Robonine parallel gripper
  camera_holder: { kind: 'plastic', zone: 'wrist', label: { en: 'Camera holder', ru: 'Держатель камеры' } },
  hand: { kind: 'plastic', zone: 'gripper', label: { en: 'Gripper body', ru: 'Корпус захвата' } },
  hand_gear: { kind: 'plastic', zone: 'gripper', label: { en: 'Gripper gear', ru: 'Шестерня захвата' } },
  left_finger: { kind: 'plastic', zone: 'gripper', label: { en: 'Left finger', ru: 'Левый палец' } },
  right_finger: { kind: 'plastic', zone: 'gripper', label: { en: 'Right finger', ru: 'Правый палец' } },
  left_finger_gear_rack: { kind: 'plastic', zone: 'gripper', label: { en: 'Left gear rack', ru: 'Левая рейка' } },
  right_finger_gear_rack: { kind: 'plastic', zone: 'gripper', label: { en: 'Right gear rack', ru: 'Правая рейка' } },
  // Bought components
  sts3215_03a_v1: { kind: 'motor', zone: 'base', label: { en: 'STS3215 servo', ru: 'Сервопривод STS3215' } },
  sts3215_03a_no_horn_v1: { kind: 'motor', zone: 'base', label: { en: 'STS3215 servo', ru: 'Сервопривод STS3215' } },
  hand_servo: { kind: 'motor', zone: 'gripper', label: { en: 'STS3215 servo', ru: 'Сервопривод STS3215' } },
  camera: { kind: 'electronics', zone: 'wrist', label: { en: 'Camera module', ru: 'Модуль камеры' } },
  // SO-ARM102: one merged mesh per link, motors included
  base_link: { kind: 'combined', zone: 'base', label: { en: 'Base', ru: 'Основание' } },
  link1_1: { kind: 'combined', zone: 'shoulder', label: { en: 'Shoulder', ru: 'Плечо' } },
  link2_1: { kind: 'combined', zone: 'upperArm', label: { en: 'Upper arm', ru: 'Плечевое звено' } },
  link3_1: { kind: 'combined', zone: 'forearm', label: { en: 'Forearm', ru: 'Предплечье' } },
  link4_1: { kind: 'combined', zone: 'wrist', label: { en: 'Wrist', ru: 'Запястье' } },
  link5_1: { kind: 'combined', zone: 'gripper', label: { en: 'Gripper', ru: 'Захват' } },
  clamp1_1: { kind: 'combined', zone: 'gripper', label: { en: 'Left jaw', ru: 'Левая губка' } },
  clamp2_1: { kind: 'combined', zone: 'gripper', label: { en: 'Right jaw', ru: 'Правая губка' } },
}

/** Zone of a part the catalog does not know, from the URDF link it hangs off. */
const LINK_ZONES: Array<[RegExp, Zone]> = [
  [/base/, 'base'],
  [/shoulder/, 'shoulder'],
  [/upper/, 'upperArm'],
  [/lower|fore|elbow/, 'forearm'],
  [/wrist/, 'wrist'],
  [/grip|jaw|finger|hand/, 'gripper'],
]

/**
 * Sort the model's parts into what gets printed and what gets bought. Unknown
 * meshes (a model added later) fall back to the URDF material — `sts3215` is
 * the servo material in every robonine model — and to the link name for the zone.
 */
export function classifyParts(parts: RobotPartInfo[]): ClassifiedPart[] {
  return parts.map((part) => {
    const known = CATALOG[part.mesh]
    const zone = known?.zone ?? LINK_ZONES.find(([re]) => re.test(part.link))?.[1] ?? 'base'
    const kind = known?.kind ?? (part.material === 'sts3215' ? 'motor' : 'plastic')

    return { ...part, kind, zone, label: known?.label ?? { en: part.mesh, ru: part.mesh } }
  })
}

/** True for parts a skin repaints: printed plastic, or merged meshes that are mostly plastic. */
export function isPaintable(part: ClassifiedPart): boolean {
  return part.kind === 'plastic' || part.kind === 'combined'
}

/** PLA density, g/cm³. */
const PLA_DENSITY = 1.24
/**
 * Share of a part's solid volume a typical print actually fills (walls +
 * ~15 % infill). An assumption, not a slicer result: it puts a full SO-ARM101
 * follower at ≈ 280 g.
 */
const PRINT_FILL = 0.4

/** Estimated filament for one printed copy of the part, in grams. */
export function estimateGrams(part: ClassifiedPart): number {
  return part.volume * 1e6 * PLA_DENSITY * PRINT_FILL
}
