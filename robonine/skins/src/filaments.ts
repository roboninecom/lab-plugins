import type { PartFinish } from './worldViewParts'

export type LocaleText = { en: string; ru: string }

export type FilamentLineId = 'pla-basic' | 'pla-matte' | 'pla-silk' | 'pla-glow' | 'pla-translucent'

export interface FilamentLine {
  id: FilamentLineId
  label: string
  /**
   * Bambu Lab store page for the product line. The global store host
   * geo-redirects to the visitor's regional store with the same handle.
   * Per-colour variant links are not used: their ids are undocumented and
   * differ between regional stores.
   */
  url: string
  finish: PartFinish
}

export interface Filament {
  id: string
  line: FilamentLineId
  /** Colour name exactly as Bambu Lab sells it. */
  name: string
  /** Bambu colour code, shown next to the name on the store (e.g. "Jade White (10100)"). */
  code: string
  hex: string
  finish: PartFinish
  /** Glow-in-the-dark filament: rendered with a faint self-illumination. */
  glow?: boolean
}

export const FILAMENT_LINES: FilamentLine[] = [
  { id: 'pla-basic', label: 'PLA Basic', url: 'https://store.bambulab.com/products/pla-basic-filament', finish: 'basic' },
  { id: 'pla-matte', label: 'PLA Matte', url: 'https://store.bambulab.com/products/pla-matte', finish: 'matte' },
  { id: 'pla-silk', label: 'PLA Silk+', url: 'https://store.bambulab.com/products/pla-silk-upgrade', finish: 'silk' },
  { id: 'pla-glow', label: 'PLA Glow', url: 'https://store.bambulab.com/products/pla-glow', finish: 'basic' },
  { id: 'pla-translucent', label: 'PLA Translucent', url: 'https://store.bambulab.com/products/pla-translucent', finish: 'translucent' },
]

/** Ids are `<prefix>-<colour slug>`, so `basic-pumpkin-orange`; a colour name repeating the prefix ("Glow Green") is not doubled. */
function line(id: FilamentLineId, prefix: string, colours: Array<[name: string, code: string, hex: string]>): Filament[] {
  const finish = FILAMENT_LINES.find((l) => l.id === id)!.finish

  return colours.map(([name, code, hex]) => ({
    id: `${prefix}-${name.toLowerCase().replace(new RegExp(`^${prefix}\\s+`), '').replace(/[^a-z0-9]+/g, '-')}`,
    line: id,
    name,
    code,
    hex,
    finish,
    ...(id === 'pla-glow' ? { glow: true } : {}),
  }))
}

// Names, codes and hex values from Bambu Lab's colour table
// (BambuStudio resources/profiles/BBL/filament/filaments_color_codes.json),
// cross-checked against the hex-code PDFs linked from the store pages.
const ALL: Filament[] = [
  ...line('pla-basic', 'basic', [
    ['Jade White', '10100', '#FFFFFF'],
    ['Beige', '10201', '#F7E6DE'],
    ['Light Gray', '10104', '#D1D3D5'],
    ['Silver', '10102', '#A6A9AA'],
    ['Gray', '10103', '#8E9089'],
    ['Dark Gray', '10105', '#545454'],
    ['Black', '10101', '#000000'],
    ['Blue Gray', '10602', '#5B6579'],
    ['Magenta', '10202', '#EC008C'],
    ['Pink', '10203', '#F55A74'],
    ['Hot Pink', '10204', '#F5547C'],
    ['Red', '10200', '#C12E1F'],
    ['Maroon Red', '10205', '#9D2235'],
    ['Orange', '10300', '#FF6A13'],
    ['Pumpkin Orange', '10301', '#FF9016'],
    ['Gold', '10401', '#E4BD68'],
    ['Sunflower Yellow', '10402', '#FEC600'],
    ['Yellow', '10400', '#F4EE2A'],
    ['Bright Green', '10503', '#BECF00'],
    ['Bambu Green', '10501', '#00AE42'],
    ['Mistletoe Green', '10502', '#3F8E43'],
    ['Bronze', '10801', '#847D48'],
    ['Cocoa Brown', '10802', '#6F5034'],
    ['Brown', '10800', '#9D432C'],
    ['Turquoise', '10605', '#00B1B7'],
    ['Cyan', '10603', '#0086D6'],
    ['Blue', '10601', '#0A2989'],
    ['Cobalt Blue', '10604', '#0056B8'],
    ['Purple', '10700', '#5E43B7'],
    ['Indigo Purple', '10701', '#482960'],
  ]),
  ...line('pla-matte', 'matte', [
    ['Ivory White', '11100', '#FFFFFF'],
    ['Bone White', '11103', '#CBC6B8'],
    ['Desert Tan', '11401', '#E8DBB7'],
    ['Latte Brown', '11800', '#D3B7A7'],
    ['Caramel', '11803', '#AE835B'],
    ['Terracotta', '11203', '#B15533'],
    ['Dark Brown', '11801', '#7D6556'],
    ['Dark Chocolate', '11802', '#4D3324'],
    ['Lilac Purple', '11700', '#AE96D4'],
    ['Sakura Pink', '11201', '#E8AFCF'],
    ['Mandarin Orange', '11300', '#F99963'],
    ['Lemon Yellow', '11400', '#F7D959'],
    ['Plum', '11204', '#950051'],
    ['Scarlet Red', '11200', '#DE4343'],
    ['Dark Red', '11202', '#BB3D43'],
    ['Dark Green', '11501', '#68724D'],
    ['Grass Green', '11500', '#61C680'],
    ['Apple Green', '11502', '#C2E189'],
    ['Ice Blue', '11601', '#A3D8E1'],
    ['Sky Blue', '11603', '#56B7E6'],
    ['Marine Blue', '11600', '#0078BF'],
    ['Dark Blue', '11602', '#042F56'],
    ['Ash Gray', '11102', '#9B9EA0'],
    ['Nardo Gray', '11104', '#757575'],
    ['Charcoal', '11101', '#000000'],
  ]),
  ...line('pla-silk', 'silk', [
    ['White', '13110', '#FFFFFF'],
    ['Silver', '13109', '#C8C8C8'],
    ['Champagne', '13404', '#F3CFB2'],
    ['Pink', '13207', '#F7ADA6'],
    ['Rose Gold', '13206', '#BA9594'],
    ['Candy Red', '13205', '#D02727'],
    ['Gold', '13405', '#F4A925'],
    ['Mint', '13507', '#96DCB9'],
    ['Candy Green', '13506', '#018814'],
    ['Baby Blue', '13603', '#A8C6EE'],
    ['Blue', '13604', '#008BDA'],
    ['Purple', '13702', '#8671CB'],
    ['Titan Gray', '13108', '#5F6367'],
  ]),
  // Hex is the daytime colour.
  ...line('pla-glow', 'glow', [
    ['Glow Green', '15500', '#A1FFAC'],
    ['Glow Yellow', '15400', '#F8FF80'],
    ['Glow Pink', '15200', '#F17B8F'],
    ['Glow Blue', '15600', '#7AC0E9'],
    ['Glow Orange', '15300', '#FF9D5B'],
  ]),
  ...line('pla-translucent', 'translucent', [
    ['Red', '13210', '#B50011'],
    ['Cherry Pink', '13211', '#F5B6CD'],
    ['Orange', '13301', '#F74E02'],
    ['Mellow Yellow', '13410', '#F5DBAB'],
    ['Light Jade', '13510', '#96D8AF'],
    ['Ice Blue', '13610', '#B8CDE9'],
    ['Blue', '13611', '#0047BB'],
    ['Teal', '13612', '#009FA1'],
    ['Purple', '13710', '#8344B0'],
    ['Lavender', '13711', '#B8ACD6'],
  ]),
]

export const FILAMENTS: Record<string, Filament> = Object.fromEntries(ALL.map((f) => [f.id, f]))

/** Where to buy a filament: its product line's page on the Bambu Lab store. */
export function buyUrl(filament: Filament): string {
  return FILAMENT_LINES.find((l) => l.id === filament.line)!.url
}
