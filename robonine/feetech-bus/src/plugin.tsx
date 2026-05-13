import { REGISTER_MAP, ADDR_LOCK, EEPROM_BLOCK_LEN, RAM_BLOCK_LEN, RAM_START, decodeRegisters, type StsRegister } from './registerMap'
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { translations, type Copies } from './translations'
import type { PluginContext } from '@robonine/plugin-sdk'
import { Search } from 'lucide-react'

interface Props {
  context: PluginContext
}

type Tab = 'map' | 'custom'

function parseAddress(s: string): number | null {
  const trimmed = s.trim()

  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    const n = parseInt(trimmed.slice(2), 16)

    return isNaN(n) ? null : n
  }

  const n = parseInt(trimmed, 10)

  return isNaN(n) ? null : n
}

function parseDataBytes(s: string): number[] | null {
  const parts = s.trim().split(/\s+/).filter(Boolean)
  const bytes: number[] = []

  if (parts.length === 0) {
    return null
  }

  for (const p of parts) {
    const n = parseInt(p, 10)

    if (isNaN(n) || n < 0 || n > 255) {
      return null
    }
    bytes.push(n)
  }

  return bytes
}

function toHex(v: number | undefined, bytes: number): string {
  if (v === undefined) {
    return ''
  }

  return (
    '0x' +
    v
      .toString(16)
      .padStart(bytes * 2, '0')
      .toUpperCase()
  )
}

type TooltipUi = Pick<PluginContext['ui'], 'Tooltip' | 'TooltipContent' | 'TooltipProvider' | 'TooltipTrigger'>

function ValueCell({
  reg,
  value,
  editing,
  editValue,
  writing,
  copies,
  ui,
  onStartEdit,
  onEditChange,
  onCommit,
  onCancel,
}: {
  reg: StsRegister
  value: number | undefined
  editing: boolean
  editValue: string
  writing: boolean
  copies: Copies
  ui: TooltipUi
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } = ui
  const display = `${value}`
  const hex = toHex(value, reg.bytes)

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onCommit()
            } else if (e.key === 'Escape') {
              onCancel()
            }
          }}
          className="w-20 h-6 text-xs px-1.5 rounded border border-input bg-background font-mono"
        />
        <button disabled={writing} onClick={onCommit} className="text-xs px-1.5 h-6 rounded bg-primary text-primary-foreground disabled:opacity-50">
          {copies.confirm}
        </button>
        <button onClick={onCancel} className="text-xs px-1.5 h-6 rounded border border-input text-muted-foreground">
          {copies.cancel}
        </button>
      </div>
    )
  }

  if (value === undefined) {
    return <span className="text-muted-foreground text-xs">{copies.noData}</span>
  }

  if (reg.access === 'RW') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onStartEdit} className="cursor-pointer font-mono text-xs hover:underline text-left text-primary">
              {display}
            </button>
          </TooltipTrigger>
          <TooltipContent>{`${hex} — ${copies.clickToEdit}`}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <span title={hex} className="font-mono text-xs">
      {display}
    </span>
  )
}

export function PluginRoot({ context }: Props) {
  const copies = useMemo(() => translations[context.locale] ?? translations['en'], [context.locale])
  const { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Button, Input, Card } = context.ui
  const connected = context.connection.connected
  const [servoId, setServoId] = useState(1)
  const [tab, setTab] = useState<Tab>('map')
  const [readValues, setReadValues] = useState<Record<number, number> | null>(null)
  const [reading, setReading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [foundIds, setFoundIds] = useState<number[] | null>(null)
  const [editAddr, setEditAddr] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [writing, setWriting] = useState(false)
  const [filter, setFilter] = useState('')

  // Custom R/W state
  const [cReadAddr, setCReadAddr] = useState('')
  const [cReadLen, setCReadLen] = useState('2')
  const [cReadResult, setCReadResult] = useState<string | null>(null)
  const [cReadLoading, setCReadLoading] = useState(false)
  const [cWriteAddr, setCWriteAddr] = useState('')
  const [cWriteData, setCWriteData] = useState('')
  const [cWriteLoading, setCWriteLoading] = useState(false)
  const abortRef = useRef(false)

  const readAll = useCallback(async () => {
    setReading(true)
    abortRef.current = false
    try {
      const [eeprom, ram] = await Promise.all([context.servo.readRegisters(servoId, 0, EEPROM_BLOCK_LEN), context.servo.readRegisters(servoId, RAM_START, RAM_BLOCK_LEN)])
      const raw = [...eeprom, ...ram]

      setReadValues(decodeRegisters(raw))
      setFoundIds(null)
    } catch {
      context.toast.error(copies.readError)
    } finally {
      setReading(false)
    }
  }, [context, servoId, copies])

  useEffect(() => {
    if (connected) {
      readAll()
    }
  }, [connected])

  const scanBus = useCallback(async () => {
    const found: number[] = []

    setScanning(true)

    for (let id = 1; id <= 20; id++) {
      if (abortRef.current) {
        break
      }
      try {
        await context.servo.readRegisters(id, 56, 2)
        found.push(id)
      } catch {
        // servo not present at this id
      }
    }
    setFoundIds(found)
    setScanning(false)
    if (found.length > 0) {
      setServoId(found[0]!)
    }
  }, [context])

  const startEdit = useCallback(
    (reg: StsRegister) => {
      setEditAddr(reg.addr)
      setEditValue(String(readValues?.[reg.addr] ?? 0))
    },
    [readValues],
  )

  const commitWrite = useCallback(
    async (reg: StsRegister) => {
      const num = parseInt(editValue, 10)

      if (isNaN(num) || num < 0) {
        return
      }
      setWriting(true)
      try {
        const isEeprom = reg.area === 'EEPROM'
        const data = reg.bytes === 1 ? [num & 0xff] : [num & 0xff, (num >> 8) & 0xff]

        if (isEeprom) {
          await context.servo.writeRegisters(servoId, ADDR_LOCK, [0])
        }
        await context.servo.writeRegisters(servoId, reg.addr, data)
        if (isEeprom) {
          await context.servo.writeRegisters(servoId, ADDR_LOCK, [1])
        }
        setReadValues((prev) => (prev ? { ...prev, [reg.addr]: num } : null))
        setEditAddr(null)
        context.toast.success(copies.writeSuccess)
      } catch {
        context.toast.error(copies.writeError)
      } finally {
        setWriting(false)
      }
    },
    [context, servoId, editValue, copies],
  )

  const doCustomRead = useCallback(async () => {
    const addr = parseAddress(cReadAddr)
    const len = parseInt(cReadLen, 10)

    if (addr === null || isNaN(len) || len < 1) {
      return
    }
    setCReadLoading(true)
    setCReadResult(null)
    try {
      const bytes = await context.servo.readRegisters(servoId, addr, len)
      const hex = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
      const dec = bytes.join(' ')

      setCReadResult(`hex: ${hex}\ndec: ${dec}`)
    } catch {
      setCReadResult('Error: read failed')
    } finally {
      setCReadLoading(false)
    }
  }, [context, servoId, cReadAddr, cReadLen])

  const doCustomWrite = useCallback(async () => {
    const addr = parseAddress(cWriteAddr)
    const data = parseDataBytes(cWriteData)

    if (addr === null || !data) {
      return
    }
    setCWriteLoading(true)
    try {
      const isEeprom = addr < RAM_START
      const actualAddr = addr

      if (isEeprom) {
        await context.servo.writeRegisters(servoId, ADDR_LOCK, [0])
      }
      await context.servo.writeRegisters(servoId, actualAddr, data)
      if (isEeprom) {
        await context.servo.writeRegisters(servoId, ADDR_LOCK, [1])
      }
      context.toast.success(copies.writeSuccess)
    } catch {
      context.toast.error(copies.writeError)
    } finally {
      setCWriteLoading(false)
    }
  }, [context, servoId, cWriteAddr, cWriteData, copies])

  const filterLower = filter.toLowerCase()
  const matchesFilter = (r: (typeof REGISTER_MAP)[0]) => !filterLower || r.name.toLowerCase().includes(filterLower) || r.description.toLowerCase().includes(filterLower)
  const eepromRegs = REGISTER_MAP.filter((r) => r.area === 'EEPROM' && matchesFilter(r))
  const ramRegs = REGISTER_MAP.filter((r) => r.area === 'RAM' && matchesFilter(r))

  return (
    <div className="flex flex-col h-full min-h-0 gap-0">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b shrink-0">
        <span className="font-semibold text-sm mr-2">{copies.title}</span>

        <label className="text-sm text-muted-foreground">{copies.servoId}</label>
        <input
          type="number"
          min={1}
          max={253}
          value={servoId}
          onChange={(e) => setServoId(Math.max(1, Math.min(253, Number(e.target.value))))}
          className="w-16 h-8 text-sm px-2 rounded border border-input bg-background font-mono"
          disabled={!connected}
        />

        <Button size="sm" variant="outline" onClick={scanBus} disabled={!connected || scanning || reading}>
          {scanning ? copies.scanning : copies.scan}
        </Button>

        <Button size="sm" onClick={readAll} disabled={!connected || reading || scanning}>
          {reading ? copies.reading : copies.readAll}
        </Button>

        {foundIds !== null && <span className="text-xs text-muted-foreground">{foundIds.length > 0 ? `${copies.scanFound}: ${foundIds.join(', ')}` : copies.scanNone}</span>}

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={filter} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)} placeholder={copies.filterPlaceholder} className="h-8 w-64 text-sm pl-7" />
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-0 border-b shrink-0 px-4">
        {(['map', 'custom'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-2 border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t === 'map' ? copies.tabMap : copies.tabCustom}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto min-h-0">
        {!connected && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
            <p className="font-medium text-sm">{copies.notConnected}</p>
            <p className="text-xs text-muted-foreground">{copies.notConnectedHint}</p>
            <Button size="sm" variant="outline" onClick={context.openConnectDialog}>
              {copies.connect}
            </Button>
          </div>
        )}

        {connected && tab === 'map' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">{copies.colAddr}</TableHead>
                <TableHead className="min-w-40">{copies.colName}</TableHead>
                <TableHead className="w-8 text-center">{copies.colBytes}</TableHead>
                <TableHead className="w-12 text-center">{copies.colAccess}</TableHead>
                <TableHead className="w-16">{copies.colDefault}</TableHead>
                <TableHead className="w-36">{copies.colRange}</TableHead>
                <TableHead className="w-36">{copies.colValue}</TableHead>
                <TableHead>{copies.colDescription}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* EEPROM section */}
              {eepromRegs.length > 0 && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={8} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground tracking-wide uppercase">
                    {copies.sectionEeprom}
                  </TableCell>
                </TableRow>
              )}
              {eepromRegs.map((reg) => (
                <RegisterTableRow
                  key={reg.addr}
                  reg={reg}
                  value={readValues?.[reg.addr]}
                  editing={editAddr === reg.addr}
                  editValue={editValue}
                  writing={writing}
                  copies={copies}
                  ui={context.ui}
                  onStartEdit={() => startEdit(reg)}
                  onEditChange={setEditValue}
                  onCommit={() => commitWrite(reg)}
                  onCancel={() => setEditAddr(null)}
                />
              ))}

              {/* RAM section */}
              {ramRegs.length > 0 && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={8} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground tracking-wide uppercase">
                    {copies.sectionRam}
                  </TableCell>
                </TableRow>
              )}
              {ramRegs.map((reg) => (
                <RegisterTableRow
                  key={reg.addr}
                  reg={reg}
                  value={readValues?.[reg.addr]}
                  editing={editAddr === reg.addr}
                  editValue={editValue}
                  writing={writing}
                  copies={copies}
                  ui={context.ui}
                  onStartEdit={() => startEdit(reg)}
                  onEditChange={setEditValue}
                  onCommit={() => commitWrite(reg)}
                  onCancel={() => setEditAddr(null)}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {connected && tab === 'custom' && (
          <div className="flex flex-col gap-4 p-4 max-w-lg">
            <p className="text-xs text-muted-foreground">{copies.lockUnlockNote}</p>

            {/* Read */}
            <Card className="p-4 flex flex-col gap-3">
              <p className="text-sm font-medium">{copies.customReadTitle}</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{copies.address}</label>
                  <Input value={cReadAddr} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCReadAddr(e.target.value)} placeholder={copies.addressHint} className="w-32 font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{copies.length}</label>
                  <Input type="number" min={1} max={32} value={cReadLen} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCReadLen(e.target.value)} className="w-20 font-mono text-sm" />
                </div>
                <Button onClick={doCustomRead} disabled={cReadLoading || !cReadAddr} size="sm">
                  {cReadLoading ? '…' : copies.read}
                </Button>
              </div>
              {cReadResult && <pre className="text-xs font-mono bg-muted rounded p-2 whitespace-pre-wrap break-all">{cReadResult}</pre>}
            </Card>

            {/* Write */}
            <Card className="p-4 flex flex-col gap-3">
              <p className="text-sm font-medium">{copies.customWriteTitle}</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{copies.address}</label>
                  <Input value={cWriteAddr} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCWriteAddr(e.target.value)} placeholder={copies.addressHint} className="w-32 font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{copies.data}</label>
                  <Input value={cWriteData} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCWriteData(e.target.value)} placeholder={copies.dataHint} className="w-56 font-mono text-sm" />
                </div>
                <Button onClick={doCustomWrite} disabled={cWriteLoading || !cWriteAddr || !cWriteData} size="sm" variant="destructive">
                  {cWriteLoading ? '…' : copies.write}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function RegisterTableRow({
  reg,
  value,
  editing,
  editValue,
  writing,
  copies,
  ui,
  onStartEdit,
  onEditChange,
  onCommit,
  onCancel,
}: {
  reg: StsRegister
  value: number | undefined
  editing: boolean
  editValue: string
  writing: boolean
  copies: Copies
  ui: TooltipUi
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const addrHex = '0x' + reg.addr.toString(16).padStart(2, '0').toUpperCase()

  return (
    <tr className="border-b transition-colors hover:bg-muted/40">
      <td className="px-4 py-1.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
        <span title={String(reg.addr)}>{addrHex}</span>
      </td>
      <td className="px-4 py-1.5 text-sm font-medium whitespace-nowrap">{reg.name}</td>
      <td className="px-4 py-1.5 text-xs text-center text-muted-foreground">{reg.bytes}</td>
      <td className="px-4 py-1.5 text-xs text-center">
        <span className={reg.access === 'RW' ? 'text-blue-500 dark:text-blue-400 font-medium' : 'text-muted-foreground'}>{reg.access}</span>
      </td>
      <td className="px-4 py-1.5 text-xs font-mono text-muted-foreground">{reg.defaultVal}</td>
      <td className="px-4 py-1.5 text-xs text-muted-foreground max-w-36 truncate" title={reg.range}>
        {reg.range}
      </td>
      <td className="px-4 py-1.5 text-xs">
        <ValueCell
          reg={reg}
          value={value}
          editing={editing}
          editValue={editValue}
          writing={writing}
          copies={copies}
          ui={ui}
          onStartEdit={onStartEdit}
          onEditChange={onEditChange}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </td>
      <td className="px-4 py-1.5 text-xs text-muted-foreground max-w-xs" title={reg.description}>
        <span className="line-clamp-2">{reg.description}</span>
      </td>
    </tr>
  )
}
