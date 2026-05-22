// LeRobot Dataset v3.0 browser-only exporter
// Format: https://huggingface.co/docs/lerobot/lerobot-dataset-v3

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { SavedEpisode } from './types'

// ── Thrift compact binary protocol ──────────────────────────────────────────

// Type IDs
const TI32 = 5
const TI64 = 6
const TBINARY = 8
const TLIST = 9
const TSTRUCT = 12
const TBOOL_TRUE = 1
const TBOOL_FALSE = 2

class TW {
  private b: number[] = []
  private fid = 0
  private stk: number[] = []

  nest(): void {
    this.stk.push(this.fid)
    this.fid = 0
  }
  unnest(): void {
    this.fid = this.stk.pop()!
  }

  private vi(n: number): void {
    n = n >>> 0
    while (n > 0x7f) {
      this.b.push((n & 0x7f) | 0x80)
      n >>>= 7
    }
    this.b.push(n)
  }

  private vib(n: bigint): void {
    n = BigInt.asUintN(64, n)
    while (n > 0x7fn) {
      this.b.push(Number(n & 0x7fn) | 0x80)
      n >>= 7n
    }
    this.b.push(Number(n))
  }

  private fh(type: number, id: number): void {
    const d = id - this.fid

    if (d > 0 && d <= 15) {
      this.b.push((d << 4) | type)
    } else {
      this.b.push(type)
      this.vi(((id << 1) ^ (id >> 15)) & 0x3fff)
    }
    this.fid = id
  }

  zi32(n: number): void {
    this.vi(((n << 1) ^ (n >> 31)) >>> 0)
  }
  zi64(n: bigint): void {
    this.vib((n << 1n) ^ (n >> 63n))
  }

  i32(id: number, v: number): this {
    this.fh(TI32, id)
    this.zi32(v)

    return this
  }
  i64(id: number, v: bigint): this {
    this.fh(TI64, id)
    this.zi64(v)

    return this
  }

  bool(id: number, v: boolean): this {
    const t = v ? TBOOL_TRUE : TBOOL_FALSE
    const d = id - this.fid

    if (d > 0 && d <= 15) {
      this.b.push((d << 4) | t)
    } else {
      this.b.push(t)
      this.vi(((id << 1) ^ (id >> 15)) & 0x3fff)
    }
    this.fid = id

    return this
  }

  str(id: number, s: string): this {
    const bytes = new TextEncoder().encode(s)

    this.fh(TBINARY, id)
    this.vi(bytes.length)
    for (const byte of bytes) {
      this.b.push(byte)
    }

    return this
  }

  raw(data: Uint8Array): this {
    for (const byte of data) {
      this.b.push(byte)
    }

    return this
  }

  listHdr(id: number, elemType: number, count: number): this {
    this.fh(TLIST, id)
    if (count <= 14) {
      this.b.push((count << 4) | elemType)
    } else {
      this.b.push(0xf0 | elemType)
      this.vi(count >>> 0)
    }

    return this
  }

  structField(id: number): this {
    this.fh(TSTRUCT, id)
    this.nest()

    return this
  }
  endNested(): this {
    this.b.push(0)
    this.unnest()

    return this
  }
  stop(): this {
    this.b.push(0)

    return this
  }

  // List element writers (no field header)
  elI32(v: number): this {
    this.zi32(v)

    return this
  }
  elI64(v: bigint): this {
    this.zi64(v)

    return this
  }
  elStr(s: string): this {
    const bytes = new TextEncoder().encode(s)

    this.vi(bytes.length)
    for (const byte of bytes) {
      this.b.push(byte)
    }

    return this
  }
  elStructBegin(): this {
    this.nest()

    return this
  }
  elStructEnd(): this {
    this.b.push(0)
    this.unnest()

    return this
  }

  toU8(): Uint8Array {
    return new Uint8Array(this.b)
  }
}

// ── Parquet constants ────────────────────────────────────────────────────────

const MAGIC = new TextEncoder().encode('PAR1')

// Type enum
const PT = { BOOLEAN: 0, INT32: 1, INT64: 2, FLOAT: 4, DOUBLE: 5 }
// Repetition type enum
const RT = { REQUIRED: 0, OPTIONAL: 1, REPEATED: 2 }
// Encoding enum
const ENC = { PLAIN: 0, RLE: 3 }
// ConvertedType
const CT_LIST = 3
// CompressionCodec
const CODEC_NONE = 0
// PageType
const PAGE_DATA_V1 = 0
const PAGE_DATA_V2 = 3

// ── RLE encoder for levels ───────────────────────────────────────────────────

function rleEncode(values: number[]): Uint8Array {
  const out: number[] = []
  let i = 0

  if (values.length === 0) {
    return new Uint8Array(0)
  }

  while (i < values.length) {
    const v = values[i]
    let len = 1

    while (i + len < values.length && values[i + len] === v) {
      len++
    }
    // RLE run: varint((len << 1) | 0), then value as 1 byte; LSB=0 means RLE (LSB=1 means bit-packing)
    let h = len << 1

    while (h > 0x7f) {
      out.push((h & 0x7f) | 0x80)
      h >>>= 7
    }
    out.push(h)
    out.push(v & 0xff)
    i += len
  }

  return new Uint8Array(out)
}

// ── Parquet page and column builders ────────────────────────────────────────

type ColumnSpec =
  | { kind: 'int64'; name: string; values: bigint[] }
  | { kind: 'float'; name: string; values: number[] }
  | { kind: 'boolean'; name: string; values: boolean[] }
  | { kind: 'list_float'; name: string; values: number[][] }
  | { kind: 'list_int64'; name: string; values: bigint[][] }

// Encode plain int64 values
function plainInt64(values: bigint[]): Uint8Array {
  const buf = new Uint8Array(values.length * 8)
  const view = new DataView(buf.buffer)

  for (let i = 0; i < values.length; i++) {
    view.setBigInt64(i * 8, values[i], true)
  }

  return buf
}

// Encode plain float32 values
function plainFloat(values: number[]): Uint8Array {
  const buf = new Float32Array(values)

  return new Uint8Array(buf.buffer)
}

// Encode boolean values (bit-packed, LSB-first within each byte)
function plainBoolean(values: boolean[]): Uint8Array {
  const bytes = Math.ceil(values.length / 8)
  const out = new Uint8Array(bytes)

  for (let i = 0; i < values.length; i++) {
    if (values[i]) {
      out[i >> 3] |= 1 << (i & 7)
    }
  }

  return out
}

// Build a PageHeader Thrift blob for DATA_PAGE_V1
function pageHeaderV1(numValues: number, pageBytes: number, encoding: number, defLevelEnc: number, repLevelEnc: number): Uint8Array {
  const w = new TW()

  w.i32(1, PAGE_DATA_V1) // type
  w.i32(2, pageBytes) // uncompressed_page_size
  w.i32(3, pageBytes) // compressed_page_size
  // field 5: DataPageHeader
  w.structField(5)
    .i32(1, numValues) // num_values
    .i32(2, encoding) // encoding
    .i32(3, defLevelEnc) // definition_level_encoding
    .i32(4, repLevelEnc) // repetition_level_encoding
    .endNested()
  w.stop()

  return w.toU8()
}

// Build a PageHeader Thrift blob for DATA_PAGE_V2 (list columns)
function pageHeaderV2(numValues: number, numRows: number, pageBytes: number, repLevelBytes: number, defLevelBytes: number): Uint8Array {
  const w = new TW()

  w.i32(1, PAGE_DATA_V2) // type
  w.i32(2, pageBytes) // uncompressed_page_size
  w.i32(3, pageBytes) // compressed_page_size
  // field 8: DataPageHeaderV2
  w.structField(8)
    .i32(1, numValues) // num_values (total leaf values)
    .i32(2, 0) // num_nulls
    .i32(3, numRows) // num_rows
    .i32(4, ENC.PLAIN) // encoding
    .i32(5, defLevelBytes) // definition_levels_byte_length
    .i32(6, repLevelBytes) // repetition_levels_byte_length
    .endNested()
  w.stop()

  return w.toU8()
}

// Build a column chunk: [PageHeader Thrift blob][Page data]
// For required scalar columns
function buildScalarChunk(spec: Extract<ColumnSpec, { kind: 'int64' | 'float' | 'boolean' }>): Uint8Array {
  let pageData: Uint8Array
  const numValues = spec.values.length

  if (spec.kind === 'int64') {
    pageData = plainInt64(spec.values)
  } else if (spec.kind === 'float') {
    pageData = plainFloat(spec.values)
  } else {
    pageData = plainBoolean(spec.values)
  }

  const header = pageHeaderV1(numValues, pageData.length, ENC.PLAIN, ENC.RLE, ENC.RLE)
  const out = new Uint8Array(header.length + pageData.length)

  out.set(header, 0)
  out.set(pageData, header.length)

  return out
}

// For list columns (OPTIONAL group → REPEATED group → OPTIONAL element)
// max_rep=1, max_def=3
// Uses DATA_PAGE_V2 so rep/def byte lengths are explicit in the header (no 4-byte prefix ambiguity).
function buildListChunk(values: number[][] | bigint[][]): Uint8Array {
  const numRows = values.length
  const repLevels: number[] = []
  const defLevels: number[] = []
  const flatValues: (number | bigint)[] = []
  let valueData: Uint8Array
  let pos = 0

  for (let r = 0; r < numRows; r++) {
    const row = values[r]

    for (let e = 0; e < row.length; e++) {
      repLevels.push(e === 0 ? 0 : 1)
      defLevels.push(3)
      flatValues.push(row[e])
    }
  }

  const numLeafValues = flatValues.length
  // DATA_PAGE_V2: raw RLE bytes, no 4-byte length prefix
  const repData = rleEncode(repLevels)
  const defData = rleEncode(defLevels)

  if (numLeafValues > 0 && typeof flatValues[0] === 'bigint') {
    valueData = plainInt64(flatValues as bigint[])
  } else {
    valueData = plainFloat(flatValues as number[])
  }

  const pageBytes = repData.length + defData.length + valueData.length
  const header = pageHeaderV2(numLeafValues, numRows, pageBytes, repData.length, defData.length)
  const out = new Uint8Array(header.length + pageBytes)

  out.set(header, pos)
  pos += header.length
  out.set(repData, pos)
  pos += repData.length
  out.set(defData, pos)
  pos += defData.length
  out.set(valueData, pos)

  return out
}

// ── Schema element helpers ───────────────────────────────────────────────────

type SchemaElement = {
  type?: number
  repType: number
  name: string
  numChildren?: number
  convertedType?: number
}

function writeSchemaEl(w: TW, el: SchemaElement): void {
  w.elStructBegin()
  if (el.type !== undefined) {
    w.i32(1, el.type)
  }
  w.i32(3, el.repType)
  w.str(4, el.name)
  if (el.numChildren !== undefined) {
    w.i32(5, el.numChildren)
  }
  if (el.convertedType !== undefined) {
    w.i32(6, el.convertedType)
  }
  w.elStructEnd()
}

// Schema elements for a list column (3-level: group→list→element)
function listSchemaElements(name: string, elemType: number): SchemaElement[] {
  return [
    { repType: RT.OPTIONAL, name, numChildren: 1, convertedType: CT_LIST },
    { repType: RT.REPEATED, name: 'list', numChildren: 1 },
    { type: elemType, repType: RT.OPTIONAL, name: 'element' },
  ]
}

// ── Parquet file builder ─────────────────────────────────────────────────────

type ColumnInfo = {
  spec: ColumnSpec
  schemaElements: SchemaElement[]
  type: number // leaf parquet type
  pathInSchema: string[]
}

function columnInfo(spec: ColumnSpec): ColumnInfo {
  switch (spec.kind) {
    case 'int64':
      return {
        spec,
        schemaElements: [{ type: PT.INT64, repType: RT.REQUIRED, name: spec.name }],
        type: PT.INT64,
        pathInSchema: [spec.name],
      }
    case 'float':
      return {
        spec,
        schemaElements: [{ type: PT.FLOAT, repType: RT.REQUIRED, name: spec.name }],
        type: PT.FLOAT,
        pathInSchema: [spec.name],
      }
    case 'boolean':
      return {
        spec,
        schemaElements: [{ type: PT.BOOLEAN, repType: RT.REQUIRED, name: spec.name }],
        type: PT.BOOLEAN,
        pathInSchema: [spec.name],
      }
    case 'list_float':
      return {
        spec,
        schemaElements: listSchemaElements(spec.name, PT.FLOAT),
        type: PT.FLOAT,
        pathInSchema: [spec.name, 'list', 'element'],
      }
    case 'list_int64':
      return {
        spec,
        schemaElements: listSchemaElements(spec.name, PT.INT64),
        type: PT.INT64,
        pathInSchema: [spec.name, 'list', 'element'],
      }
  }
}

function buildParquetFile(columns: ColumnSpec[], numRows: number): Uint8Array {
  const infos = columns.map(columnInfo)

  // Build all column chunk byte arrays
  const chunkDatas: Uint8Array[] = infos.map((info) => {
    const s = info.spec

    if (s.kind === 'int64') {
      return buildScalarChunk(s)
    }
    if (s.kind === 'float') {
      return buildScalarChunk(s)
    }
    if (s.kind === 'boolean') {
      return buildScalarChunk(s)
    }
    if (s.kind === 'list_float') {
      return buildListChunk(s.values)
    }

    return buildListChunk(s.values)
  })

  // Calculate offsets (after 4-byte magic)
  const offsets: number[] = []
  let pos = MAGIC.length

  // Build footer
  const w = new TW()
  let p = 0

  for (const chunk of chunkDatas) {
    offsets.push(pos)
    pos += chunk.length
  }
  // FileMetaData struct
  w.i32(1, 2) // version = 2

  // schema: root message + all schema elements
  const allSchemaEls: SchemaElement[] = [
    { repType: RT.REQUIRED, name: 'schema', numChildren: infos.reduce((n, info) => n + info.schemaElements.length, 0) },
    ...infos.flatMap((info) => info.schemaElements),
  ]

  // remove num_children adjustment: root numChildren is count of direct children (top-level cols)
  // actually numChildren of root = number of top-level schema elements (not all, just direct ones)
  // For simple columns: 1 element each
  // For list columns: 1 element (the outer group) — inner ones are its children
  const rootChildren = infos.length

  allSchemaEls[0].numChildren = rootChildren

  w.listHdr(2, TSTRUCT, allSchemaEls.length)
  for (const el of allSchemaEls) {
    writeSchemaEl(w, el)
  }

  w.i64(3, BigInt(numRows))

  // row_groups: one row group with all columns
  w.listHdr(4, TSTRUCT, 1)
  w.elStructBegin()

  // columns list
  w.listHdr(1, TSTRUCT, infos.length)
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]
    const chunkData = chunkDatas[i]
    const offset = offsets[i]
    // data_page_offset points to the start of the first page header (= start of chunk)
    const dataPageOffset = offset

    // Compute num_values for this column
    let numValues: number

    if (info.spec.kind === 'list_float') {
      numValues = info.spec.values.reduce((n, row) => n + row.length, 0)
    } else if (info.spec.kind === 'list_int64') {
      numValues = info.spec.values.reduce((n, row) => n + row.length, 0)
    } else {
      numValues = numRows
    }

    w.elStructBegin()
    w.i64(2, BigInt(offset)) // file_offset
    // meta_data
    w.structField(3)
      .i32(1, info.type) // type
      .listHdr(2, TI32, 1) // encodings
      .elI32(ENC.PLAIN)
      .listHdr(3, TBINARY, info.pathInSchema.length) // path_in_schema
    for (const part of info.pathInSchema) {
      w.elStr(part)
    }
    w.i32(4, CODEC_NONE) // codec
    w.i64(5, BigInt(numValues)) // num_values
    w.i64(6, BigInt(chunkData.length)) // total_uncompressed_size
    w.i64(7, BigInt(chunkData.length)) // total_compressed_size
    w.i64(9, BigInt(dataPageOffset)) // data_page_offset
    w.endNested() // end meta_data
    w.elStructEnd() // end ColumnChunk
  }

  const totalBytes = chunkDatas.reduce((n, c) => n + c.length, 0)

  w.i64(2, BigInt(totalBytes)) // total_byte_size
  w.i64(3, BigInt(numRows)) // num_rows

  w.elStructEnd() // end RowGroup

  w.str(6, 'robonine-lerobot-exporter')
  w.stop()

  const footer = w.toU8()
  const footerLen = footer.length

  // Assemble final file
  const totalSize = MAGIC.length + chunkDatas.reduce((n, c) => n + c.length, 0) + footer.length + 4 + MAGIC.length
  const file = new Uint8Array(totalSize)
  const fileView = new DataView(file.buffer)

  file.set(MAGIC, p)
  p += MAGIC.length
  for (const chunk of chunkDatas) {
    file.set(chunk, p)
    p += chunk.length
  }
  file.set(footer, p)
  p += footer.length
  fileView.setInt32(p, footerLen, true)
  p += 4
  file.set(MAGIC, p)

  return file
}

// ── ZIP writer (STORED, no compression) ─────────────────────────────────────

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (const b of data) {
    let c = (crc ^ b) & 0xff

    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    crc = (crc >>> 8) ^ c
  }

  return (crc ^ 0xffffffff) >>> 0
}

function u16le(v: number, buf: Uint8Array, off: number): void {
  buf[off] = v & 0xff
  buf[off + 1] = (v >> 8) & 0xff
}
function u32le(v: number, buf: Uint8Array, off: number): void {
  buf[off] = v & 0xff
  buf[off + 1] = (v >> 8) & 0xff
  buf[off + 2] = (v >> 16) & 0xff
  buf[off + 3] = (v >> 24) & 0xff
}

function buildZip(files: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder()
  const entries: { name: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = []
  let dataSize = 0
  let p = 0

  for (const [name, data] of files) {
    const nameBytes = enc.encode(name)
    const localHeaderSize = 30 + nameBytes.length

    entries.push({ name: nameBytes, data, crc: crc32(data), offset: dataSize })
    dataSize += localHeaderSize + data.length
  }

  const cdSize = entries.reduce((n, e) => n + 46 + e.name.length, 0)
  const total = dataSize + cdSize + 22
  const out = new Uint8Array(total)

  // Local file entries
  for (const e of entries) {
    u32le(0x04034b50, out, p)
    p += 4 // signature
    u16le(20, out, p)
    p += 2 // version needed
    u16le(0, out, p)
    p += 2 // flags
    u16le(0, out, p)
    p += 2 // compression: STORED
    u16le(0, out, p)
    p += 2 // mod time
    u16le(0, out, p)
    p += 2 // mod date
    u32le(e.crc, out, p)
    p += 4
    u32le(e.data.length, out, p)
    p += 4 // compressed size
    u32le(e.data.length, out, p)
    p += 4 // uncompressed size
    u16le(e.name.length, out, p)
    p += 2
    u16le(0, out, p)
    p += 2 // extra field length
    out.set(e.name, p)
    p += e.name.length
    out.set(e.data, p)
    p += e.data.length
  }

  const cdStart = p

  // Central directory
  for (const e of entries) {
    u32le(0x02014b50, out, p)
    p += 4 // signature
    u16le(20, out, p)
    p += 2 // version made by
    u16le(20, out, p)
    p += 2 // version needed
    u16le(0, out, p)
    p += 2 // flags
    u16le(0, out, p)
    p += 2 // compression: STORED
    u16le(0, out, p)
    p += 2 // mod time
    u16le(0, out, p)
    p += 2 // mod date
    u32le(e.crc, out, p)
    p += 4
    u32le(e.data.length, out, p)
    p += 4
    u32le(e.data.length, out, p)
    p += 4
    u16le(e.name.length, out, p)
    p += 2
    u16le(0, out, p)
    p += 2 // extra field length
    u16le(0, out, p)
    p += 2 // comment length
    u16le(0, out, p)
    p += 2 // disk start
    u16le(0, out, p)
    p += 2 // internal attrs
    u32le(0, out, p)
    p += 4 // external attrs
    u32le(e.offset, out, p)
    p += 4 // local header offset
    out.set(e.name, p)
    p += e.name.length
  }

  // End of central directory
  u32le(0x06054b50, out, p)
  p += 4
  u16le(0, out, p)
  p += 2 // disk number
  u16le(0, out, p)
  p += 2 // disk with CD
  u16le(entries.length, out, p)
  p += 2
  u16le(entries.length, out, p)
  p += 2
  u32le(cdSize, out, p)
  p += 4
  u32le(cdStart, out, p)
  p += 4
  u16le(0, out, p) // comment length

  return out
}

// ── MP4 creation from JPEG frames ────────────────────────────────────────────

async function jpegsToMp4(frames: { image: string; width: number; height: number }[], fps: number): Promise<Uint8Array | null> {
  const width = frames[0].width
  const height = frames[0].height
  const target = new ArrayBufferTarget()
  const frameDurationUs = Math.round(1_000_000 / fps)

  if (!window.VideoEncoder || !window.VideoFrame) {
    return null
  }
  if (frames.length === 0) {
    return null
  }

  const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' })

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: () => {},
  })

  encoder.configure({ codec: 'avc1.42001f', width, height, bitrate: 2_000_000 })

  for (let i = 0; i < frames.length; i++) {
    const { image } = frames[i]

    const blob = await (async () => {
      const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0))

      return new Blob([bytes], { type: 'image/jpeg' })
    })()

    const bitmap = await createImageBitmap(blob)
    const vf = new VideoFrame(bitmap, { timestamp: i * frameDurationUs, duration: frameDurationUs })

    encoder.encode(vf, { keyFrame: i % 30 === 0 })
    vf.close()
    bitmap.close()
  }

  await encoder.flush()
  encoder.close()
  muxer.finalize()

  return new Uint8Array(target.buffer)
}

// ── Stats computation ────────────────────────────────────────────────────────

function computeStats(vectors: number[][]): { mean: number[]; std: number[]; min: number[]; max: number[] } {
  const dim = vectors[0].length

  if (vectors.length === 0) {
    return { mean: [], std: [], min: [], max: [] }
  }

  const mean = new Array<number>(dim).fill(0)
  const mn = new Array<number>(dim).fill(Infinity)
  const mx = new Array<number>(dim).fill(-Infinity)

  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += v[i]
      if (v[i] < mn[i]) {
        mn[i] = v[i]
      }
      if (v[i] > mx[i]) {
        mx[i] = v[i]
      }
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length
  }

  const variance = new Array<number>(dim).fill(0)

  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      const d = v[i] - mean[i]

      variance[i] += d * d
    }
  }

  const std = variance.map((v) => Math.sqrt(v / vectors.length))

  return { mean, std, min: mn, max: mx }
}

// ── Main export function ─────────────────────────────────────────────────────

function sortedJointNames(joints: Record<string, number>): string[] {
  return Object.keys(joints).sort()
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportAsLerobotV3(episodes: SavedEpisode[]): Promise<void> {
  // Determine joint and sensor names from first episode with frames
  const firstEp = episodes.find((e) => e.frames.length > 0)

  // Task index mapping
  const taskMap = new Map<string, number>()

  // Determine FPS from first non-trivial episode
  const refEp = episodes.find((e) => e.frames.length > 1)
  const hasImages = episodes.some((e) => e.frames.some((f) => f.image !== null))
  const cameraKey = 'observation.images.top'

  // ── Build data rows for data parquet ────────────────────────────────────────
  let globalIndex = 0

  const col = {
    index: [] as bigint[],
    timestamp: [] as number[],
    frameIndex: [] as bigint[],
    episodeIndex: [] as bigint[],
    taskIndex: [] as bigint[],
    nextDone: [] as boolean[],
    obsState: [] as number[][],
    action: [] as number[][],
  }

  // ── Build episodes parquet ───────────────────────────────────────────────────
  const epIndices = episodes.map((_, i) => BigInt(i))
  const epLengths = episodes.map((ep) => BigInt(ep.frames.length))

  // ── Assemble files map ───────────────────────────────────────────────────────
  const enc = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  const name = episodes.length === 1 ? `lerobot_episode_${episodes[0].id.slice(0, 8)}.zip` : `lerobot_dataset_${Date.now()}.zip`

  if (episodes.length === 0) {
    return
  }
  if (!firstEp) {
    return
  }

  const jointNames = sortedJointNames(firstEp.frames[0].joints)
  const sensorNames = firstEp.frames[0].sensors ? Object.keys(firstEp.frames[0].sensors).sort() : []
  const stateNames = [...jointNames, ...sensorNames]
  const actionNames = jointNames

  for (const ep of episodes) {
    if (!taskMap.has(ep.task)) {
      taskMap.set(ep.task, taskMap.size)
    }
  }

  const fps = refEp ? Math.round(((refEp.frames.length - 1) * 1000) / (refEp.frames[refEp.frames.length - 1].ts - refEp.frames[0].ts)) : 20

  for (let ei = 0; ei < episodes.length; ei++) {
    const ep = episodes[ei]
    const epTaskIdx = taskMap.get(ep.task) ?? 0
    const startTs = ep.frames[0]?.ts ?? 0

    for (let fi = 0; fi < ep.frames.length; fi++) {
      const frame = ep.frames[fi]
      const state = stateNames.map((n) => frame.joints[n] ?? frame.sensors?.[n] ?? 0)
      const action = actionNames.map((n) => frame.joints[n] ?? 0)

      col.index.push(BigInt(globalIndex++))
      col.timestamp.push((frame.ts - startTs) / 1000)
      col.frameIndex.push(BigInt(fi))
      col.episodeIndex.push(BigInt(ei))
      col.taskIndex.push(BigInt(epTaskIdx))
      col.nextDone.push(fi === ep.frames.length - 1)
      col.obsState.push(state)
      col.action.push(action)
    }
  }

  const totalFrames = col.index.length

  // ── Build data parquet ───────────────────────────────────────────────────────
  const dataParquet = buildParquetFile(
    [
      { kind: 'list_float', name: 'observation.state', values: col.obsState },
      { kind: 'list_float', name: 'action', values: col.action },
      { kind: 'float', name: 'timestamp', values: col.timestamp },
      { kind: 'int64', name: 'frame_index', values: col.frameIndex },
      { kind: 'int64', name: 'episode_index', values: col.episodeIndex },
      { kind: 'int64', name: 'index', values: col.index },
      { kind: 'int64', name: 'task_index', values: col.taskIndex },
      { kind: 'boolean', name: 'next.done', values: col.nextDone },
    ],
    totalFrames,
  )

  const epTasks = episodes.map((ep) => [BigInt(taskMap.get(ep.task) ?? 0)])

  const episodesParquet = buildParquetFile(
    [
      { kind: 'int64', name: 'episode_index', values: epIndices },
      { kind: 'list_int64', name: 'tasks', values: epTasks },
      { kind: 'int64', name: 'length', values: epLengths },
    ],
    episodes.length,
  )

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stateStats = computeStats(col.obsState)
  const actionStats = computeStats(col.action)
  const tsStats = computeStats(col.timestamp.map((t) => [t]))

  const statsJson = JSON.stringify(
    {
      'observation.state': stateStats,
      action: actionStats,
      timestamp: { mean: tsStats.mean, std: tsStats.std, min: tsStats.min, max: tsStats.max },
    },
    null,
    2,
  )

  // ── info.json ────────────────────────────────────────────────────────────────
  const features: Record<string, unknown> = {
    'observation.state': { dtype: 'float32', shape: [stateNames.length], names: stateNames },
    action: { dtype: 'float32', shape: [actionNames.length], names: actionNames },
    timestamp: { dtype: 'float32', shape: [1], names: null },
    frame_index: { dtype: 'int64', shape: [1], names: null },
    episode_index: { dtype: 'int64', shape: [1], names: null },
    index: { dtype: 'int64', shape: [1], names: null },
    task_index: { dtype: 'int64', shape: [1], names: null },
    'next.done': { dtype: 'bool', shape: [1], names: null },
  }

  if (hasImages) {
    const w = episodes.find((e) => e.frames.some((f) => f.imageWidth))?.frames.find((f) => f.imageWidth)
    const imgW = w?.imageWidth ?? 640
    const imgH = w?.imageHeight ?? 480

    features[cameraKey] = {
      dtype: 'video',
      shape: [imgH, imgW, 3],
      names: ['height', 'width', 'channels'],
      video_info: {
        'video.fps': fps,
        'video.codec': 'h264',
        'video.pix_fmt': 'yuv420p',
        'video.is_depth_map': false,
        has_audio: false,
      },
    }
  }

  const infoJson = JSON.stringify(
    {
      codebase_version: 'v3.0',
      robot_type: firstEp.robotModel || 'unknown',
      total_episodes: episodes.length,
      total_frames: totalFrames,
      total_tasks: taskMap.size,
      total_videos: hasImages ? episodes.length : 0,
      total_chunks: 1,
      chunks_size: 1000,
      fps,
      splits: { train: `0:${episodes.length}` },
      data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
      video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/episode_{episode_index:06d}.mp4',
      features,
    },
    null,
    2,
  )

  // ── tasks.jsonl ──────────────────────────────────────────────────────────────
  const tasksJsonl = [...taskMap.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([task, task_index]) => JSON.stringify({ task_index, task }))
    .join('\n')

  files.set('meta/info.json', enc.encode(infoJson))
  files.set('meta/stats.json', enc.encode(statsJson))
  files.set('meta/tasks.jsonl', enc.encode(tasksJsonl))
  files.set('meta/episodes/chunk-000/file-000.parquet', episodesParquet)
  files.set('data/chunk-000/file-000.parquet', dataParquet)

  // ── Videos — one MP4 per episode ────────────────────────────────────────────
  if (hasImages) {
    for (let ei = 0; ei < episodes.length; ei++) {
      const ep = episodes[ei]
      const epFrames = ep.frames.filter((f) => f.image !== null && f.imageWidth && f.imageHeight).map((f) => ({ image: f.image!, width: f.imageWidth!, height: f.imageHeight! }))

      if (epFrames.length === 0) {
        continue
      }

      const mp4 = await jpegsToMp4(epFrames, fps)

      if (mp4) {
        const epIdx = String(ei).padStart(6, '0')

        files.set(`videos/${cameraKey}/chunk-000/episode_${epIdx}.mp4`, mp4)
      }
    }
  }

  // ── Build and download ZIP ───────────────────────────────────────────────────
  const zip = buildZip(files)

  triggerDownload(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), name)
}
