import { BADGES, SMALL_SPRITES, SPRITES, type BadgeName, type Sheet, type SpriteModel, type SpriteState } from './sprites'

export type { BadgeName, SpriteState }
export type IconSize = 'large' | 'small'
export type IconSpec = { model?: string; state: SpriteState; size: IconSize }
export type IconCells = { columns: number; rows: number; cells: string }

const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20
const DEFAULT_COLOR = 0x01000000
const BYTES_PER_CELL = 12

const toRgb = (hex: string): number => parseInt(hex.slice(1), 16)

/** Terminal rows one icon of this size takes: two pixel rows per row. */
export const iconRows = (size: IconSize): number =>
  Math.ceil((size === 'large' ? SPRITES : SMALL_SPRITES).sonnet.frames.idle.length / 2)

/** Terminal columns one icon of this size takes. */
export const iconColumns = (size: IconSize): number =>
  ((size === 'large' ? SPRITES : SMALL_SPRITES).sonnet.frames.idle[0] ?? '').length

export const badgeRows = (): number => Math.ceil(BADGES.frames.research.length / 2)

// A member with no model gets the sonnet mascot in grey.
function greyOf<K extends string>(sheet: Sheet<K>): Sheet<K> {
  const palette = Object.fromEntries(
    Object.entries(sheet.palette).map(([letter, hex]) => {
      const rgb = toRgb(hex)
      const grey = Math.round(0.3 * (rgb >> 16) + 0.59 * ((rgb >> 8) & 255) + 0.11 * (rgb & 255))
      return [letter, `#${[grey, grey, grey].map(v => v.toString(16).padStart(2, '0')).join('')}`]
    }),
  )
  return { ...sheet, palette }
}

const GREY = { large: greyOf(SPRITES.sonnet), small: greyOf(SMALL_SPRITES.sonnet) }

function sheetFor(model: string | undefined, size: IconSize): Sheet<SpriteState> {
  const sheets = size === 'large' ? SPRITES : SMALL_SPRITES
  return model !== undefined && model in sheets ? sheets[model as SpriteModel] : GREY[size]
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Packs one frame for a Raster: two pixel rows become one terminal row of half blocks. */
function pack(palette: Record<string, string>, pixels: readonly string[]): IconCells {
  const columns = pixels[0]?.length ?? 0
  const rows = Math.ceil(pixels.length / 2)
  const words = new Uint32Array(columns * rows * 3)
  const colorAt = (y: number, x: number): number | undefined => {
    const letter = pixels[y]?.[x]
    const hex = letter === undefined ? undefined : palette[letter]
    return hex === undefined ? undefined : toRgb(hex)
  }

  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < columns; x++) {
      const top = colorAt(row * 2, x)
      const bottom = colorAt(row * 2 + 1, x)
      const at = (row * columns + x) * 3
      const [glyph, fg, bg] =
        top !== undefined && bottom !== undefined
          ? [UPPER_HALF, top, bottom]
          : top !== undefined
            ? [UPPER_HALF, top, DEFAULT_COLOR]
            : bottom !== undefined
              ? [LOWER_HALF, bottom, DEFAULT_COLOR]
              : [SPACE, DEFAULT_COLOR, DEFAULT_COLOR]
      words[at] = glyph
      words[at + 1] = fg
      words[at + 2] = bg
    }
  }

  return { columns, rows, cells: base64(new Uint8Array(words.buffer, 0, columns * rows * BYTES_PER_CELL)) }
}

// The same icons are asked for on every redraw, so each one is packed once.
const packed = new Map<string, IconCells>()

function cached(key: string, make: () => IconCells): IconCells {
  const hit = packed.get(key)
  if (hit) return hit
  const made = make()
  packed.set(key, made)
  return made
}

export function iconCells({ model, state, size }: IconSpec): IconCells {
  return cached(`${size}:${model ?? '-'}:${state}`, () => {
    const sheet = sheetFor(model, size)
    return pack(sheet.palette, sheet.frames[state])
  })
}

export function badgeCells(name: BadgeName): IconCells {
  return cached(`badge:${name}`, () => pack(BADGES.palette, BADGES.frames[name]))
}

// Checked in order: "安全審查員" is security, not research.
const BADGE_RULES: readonly [BadgeName, RegExp][] = [
  ['security', /安全|資安|漏洞|security/i],
  ['test', /測試|驗證|QA|test/i],
  ['docs', /文件|文檔|說明|docs?\b/i],
  ['integrate', /整合|合併|統整|integrat/i],
  ['design', /設計|介面|UI|UX|design/i],
  ['lead', /隊長|主管|領導|lead|captain/i],
  ['build', /實作|開發|工程|修正|build|implement|dev/i],
  ['research', /效能|研究|調查|分析|搜尋|審查|review|research|perf/i],
]

/** The badge a member's name and role suggest, if any. */
export function badgeFor(name: string, role: string): BadgeName | undefined {
  const text = `${name} ${role}`
  return BADGE_RULES.find(([, rule]) => rule.test(text))?.[0]
}
