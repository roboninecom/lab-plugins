import type { JointInfo, PluginContext } from '@robonine/plugin-sdk'
import { ChevronDown, ExternalLink, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FILAMENTS, FILAMENT_LINES, buyUrl, type Filament } from './filaments'
import { classifyParts, estimateGrams, isPaintable, ZONES, type ClassifiedPart, type Zone } from './parts'
import { CUSTOM_SKIN_ID, SKINS, type Skin } from './skins'
import { translations } from './translations'
import type { PartStyle, PartsWorldViewApi, PartsWorldViewProps } from './worldViewParts'

const STORAGE_KEY = 'robonine.skins.v1'
const DEFAULT_MODEL = 'so-arm101-robonine'
const SPOOL_GRAMS = 1000

interface Stored {
  skinId: string
  custom: Pick<Skin, 'zones' | 'parts'>
}

function readStored(): Stored {
  const fallback: Stored = { skinId: SKINS[0].id, custom: { zones: { ...SKINS[0].zones } } }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Stored>) } : fallback
  } catch {
    return fallback
  }
}

function writeStored(value: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* private mode — the choice just isn't remembered */
  }
}

/** Swatch fill that hints at the finish: a sheen for silk, a halo for glow. */
function swatchStyle(f: Filament): React.CSSProperties {
  if (f.finish === 'silk') {
    return { background: `linear-gradient(135deg, ${f.hex} 0%, #ffffff 45%, ${f.hex} 70%)` }
  }
  if (f.glow) {
    return { background: f.hex, boxShadow: `0 0 6px 1px ${f.hex}` }
  }
  if (f.finish === 'translucent') {
    return { background: f.hex, opacity: 0.7 }
  }

  return { background: f.hex }
}

function Swatch({ filament, size = 'md' }: { filament: Filament; size?: 'sm' | 'md' }) {
  return <span className={size === 'sm' ? 'inline-block size-3 shrink-0 rounded-full border' : 'inline-block size-5 shrink-0 rounded-full border'} style={swatchStyle(filament)} />
}

interface ShoppingRow {
  filament: Filament
  parts: ClassifiedPart[]
  grams: number
}

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale] ?? translations.en, [context.locale])
  const lang = context.locale === 'ru' ? 'ru' : 'en'
  const WorldView = context.WorldView as unknown as React.ForwardRefExoticComponent<PartsWorldViewProps & React.RefAttributes<PartsWorldViewApi>>
  const viewRef = useRef<PartsWorldViewApi>(null)
  const connectedModel = context.connection.connected ? context.robotConfig?.modelId : undefined
  const [modelId, setModelId] = useState<string>(connectedModel ?? DEFAULT_MODEL)
  const [stored, setStored] = useState<Stored>(readStored)
  const [parts, setParts] = useState<ClassifiedPart[]>([])
  const [openZone, setOpenZone] = useState<Zone | null>(null)
  const [hoverFilament, setHoverFilament] = useState<string | null>(null)
  const { Button } = context.ui

  const skin: Pick<Skin, 'zones' | 'parts'> = stored.skinId === CUSTOM_SKIN_ID ? stored.custom : (SKINS.find((s) => s.id === stored.skinId) ?? SKINS[0])

  useEffect(() => writeStored(stored), [stored])

  const filamentOf = useCallback((part: ClassifiedPart) => FILAMENTS[skin.parts?.[part.mesh] ?? skin.zones[part.zone]] ?? FILAMENTS[SKINS[0].zones.base], [skin])

  const handleLoad = useCallback((_joints: JointInfo[]) => {
    setParts(classifyParts(viewRef.current?.getParts() ?? []))
  }, [])

  const styles = useMemo(() => {
    const out: Record<string, PartStyle> = {}

    for (const part of parts) {
      const filament = filamentOf(part)
      const hovered = hoverFilament === filament.id

      if (isPaintable(part)) {
        out[part.id] = {
          color: filament.hex,
          finish: filament.finish,
          emissive: hovered ? '#ffffff' : filament.glow ? filament.hex : undefined,
          emissiveIntensity: hovered ? 0.35 : 0.25,
        }
      }
    }

    return out
  }, [parts, filamentOf, hoverFilament])

  useEffect(() => {
    viewRef.current?.setPartStyles(styles)
  }, [styles])

  const shopping = useMemo(() => {
    const rows = new Map<string, ShoppingRow>()

    for (const part of parts.filter(isPaintable)) {
      const filament = filamentOf(part)
      const row = rows.get(filament.id) ?? { filament, parts: [], grams: 0 }

      row.parts.push(part)
      row.grams += estimateGrams(part)
      rows.set(filament.id, row)
    }

    return [...rows.values()].sort((a, b) => b.grams - a.grams)
  }, [parts, filamentOf])

  const totalGrams = shopping.reduce((sum, row) => sum + row.grams, 0)
  const spools = shopping.reduce((sum, row) => sum + Math.max(1, Math.ceil(row.grams / SPOOL_GRAMS)), 0)
  const countOf = (kind: ClassifiedPart['kind']) => parts.filter((p) => p.kind === kind).reduce((sum, p) => sum + p.count, 0)
  const motorCount = countOf('motor')
  const electronicsCount = countOf('electronics')
  const hardwareCount = countOf('hardware')

  const chooseModel = (id: string) => {
    if (id !== modelId) {
      setParts([])
      setModelId(id)
    }
  }

  const chooseFilament = (zone: Zone, filamentId: string) => {
    // Zone changes override any per-part exceptions inside that zone.
    const keptParts = Object.fromEntries(Object.entries(skin.parts ?? {}).filter(([mesh]) => !parts.some((p) => p.mesh === mesh && p.zone === zone)))

    setStored({ skinId: CUSTOM_SKIN_ID, custom: { zones: { ...skin.zones, [zone]: filamentId }, parts: keptParts } })
  }

  const skinCards: Array<{ id: string; name: string; description: string; zones: Record<Zone, string> }> = [
    ...SKINS.map((s) => ({ id: s.id, name: s.name[lang], description: s.description[lang], zones: s.zones })),
    { id: CUSTOM_SKIN_ID, name: t.custom, description: t.customDescription, zones: stored.custom.zones },
  ]

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0 lg:flex-row" data-id="skins-plugin">
      <div className="relative overflow-hidden rounded-lg border flex-1 min-h-80">
        <WorldView ref={viewRef} robotModelId={modelId} motionMode="instant" trackLivePosition={false} onLoad={handleLoad} />
      </div>

      <div className="flex flex-col gap-5 lg:w-96 shrink-0 lg:overflow-y-auto lg:pr-1">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
        </div>

        {context.robotModels.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t.model}</p>
            <div className="flex flex-wrap gap-1.5">
              {context.robotModels.map((m) => (
                <Button key={m.id} size="sm" variant={m.id === modelId ? 'default' : 'outline'} onClick={() => chooseModel(m.id)}>
                  {m.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">{t.skins}</p>
          <div className="grid grid-cols-2 gap-2">
            {skinCards.map((card) => (
              <button
                key={card.id}
                type="button"
                data-skin={card.id}
                onClick={() => setStored((s) => ({ ...s, skinId: card.id }))}
                className={
                  card.id === stored.skinId
                    ? 'flex flex-col gap-2 rounded-lg border-2 border-primary bg-card p-3 text-left cursor-pointer'
                    : 'flex flex-col gap-2 rounded-lg border-2 border-transparent bg-card p-3 text-left cursor-pointer outline outline-1 outline-border hover:bg-accent'
                }
              >
                <div className="flex -space-x-1">
                  {ZONES.map((z) => (
                    <Swatch key={z} filament={FILAMENTS[card.zones[z]] ?? FILAMENTS[SKINS[0].zones.base]} />
                  ))}
                </div>
                <div>
                  <p className="text-sm font-medium">{card.name}</p>
                  <p className="text-xs text-muted-foreground">{card.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t.colours}</p>
            {stored.skinId === CUSTOM_SKIN_ID && (
              <Button size="sm" variant="ghost" onClick={() => setStored({ skinId: SKINS[0].id, custom: { zones: { ...SKINS[0].zones } } })}>
                <RotateCcw className="size-3.5" />
                {t.reset}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t.coloursHint}</p>
          <div className="rounded-lg border divide-y">
            {ZONES.map((zone) => {
              const filament = FILAMENTS[skin.zones[zone]] ?? FILAMENTS[SKINS[0].zones.base]

              return (
                <div key={zone}>
                  <button
                    type="button"
                    data-zone={zone}
                    onClick={() => setOpenZone(openZone === zone ? null : zone)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm cursor-pointer hover:bg-accent"
                  >
                    <span className="w-28 shrink-0 font-medium">{t.zones[zone]}</span>
                    <Swatch filament={filament} />
                    <span className="flex-1 truncate text-muted-foreground">{filament.name}</span>
                    <ChevronDown className={openZone === zone ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} />
                  </button>
                  {openZone === zone && (
                    <div className="space-y-3 px-3 pb-3 pt-1">
                      {FILAMENT_LINES.map((line) => (
                        <div key={line.id} className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">{line.label}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.values(FILAMENTS)
                              .filter((f) => f.line === line.id)
                              .map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  title={`${f.name} (${f.code})`}
                                  data-filament={f.id}
                                  onClick={() => chooseFilament(zone, f.id)}
                                  className={
                                    f.id === filament.id
                                      ? 'rounded-full p-0.5 ring-2 ring-primary cursor-pointer'
                                      : 'rounded-full p-0.5 ring-1 ring-transparent hover:ring-border cursor-pointer'
                                  }
                                >
                                  <Swatch filament={f} />
                                </button>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t.shoppingList}</p>
          <p className="text-xs text-muted-foreground">{t.shoppingHint}</p>
          <div className="rounded-lg border divide-y" data-id="skins-shopping-list">
            {shopping.map((row) => (
              <div
                key={row.filament.id}
                data-filament-row={row.filament.id}
                className="flex items-start gap-3 px-3 py-2.5"
                onMouseEnter={() => setHoverFilament(row.filament.id)}
                onMouseLeave={() => setHoverFilament(null)}
              >
                <Swatch filament={row.filament} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {row.filament.name} <span className="text-muted-foreground font-normal">({row.filament.code})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {FILAMENT_LINES.find((l) => l.id === row.filament.line)?.label} · {t.partsCount(row.parts.length)} · {t.grams(row.grams)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{[...new Set(row.parts.map((p) => p.label[lang]))].join(', ')}</p>
                </div>
                <a
                  href={buyUrl(row.filament)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent shrink-0"
                >
                  {t.buy}
                  <ExternalLink className="size-3" />
                </a>
              </div>
            ))}
            {(motorCount > 0 || electronicsCount > 0 || hardwareCount > 0) && (
              <div className="px-3 py-2.5 text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium">{t.bought}</p>
                {motorCount > 0 && <p>{t.motors(motorCount)}</p>}
                {electronicsCount > 0 && <p>{t.electronics(electronicsCount)}</p>}
                {hardwareCount > 0 && <p>{t.rods(hardwareCount)}</p>}
              </div>
            )}
          </div>
          {shopping.length > 0 && <p className="text-sm font-medium">{t.total(totalGrams, spools)}</p>}
          <p className="text-xs text-muted-foreground">{t.estimateNote}</p>
        </div>
      </div>
    </div>
  )
}
