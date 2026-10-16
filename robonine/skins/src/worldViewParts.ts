import type { PluginWorldViewProps, WorldViewApi } from '@robonine/plugin-sdk'

// The part-styling API is newer than the published SDK types, so it is
// declared here; the host's WorldView implements it at runtime.

export interface RobotPartInfo {
  /** Stable id: `<link>/<mesh>`, with a `#2`… suffix when a link repeats a mesh. */
  id: string
  link: string
  /** Mesh file name without folder and extension. */
  mesh: string
  /** URDF material name (`sts3215` = servo). */
  material: string
  /** Enclosed mesh volume, m³. */
  volume: number
}

export type PartFinish = 'basic' | 'matte' | 'silk' | 'translucent'

export interface PartStyle {
  color: string
  finish?: PartFinish
  emissive?: string
  emissiveIntensity?: number
}

export interface PartsWorldViewApi extends WorldViewApi {
  getParts(): RobotPartInfo[]
  setPartStyles(styles: Record<string, PartStyle | null>): void
}

export type PartsWorldViewProps = PluginWorldViewProps & { robotModelId?: string }
