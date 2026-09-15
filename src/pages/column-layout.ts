/** Fractional tracks divide the space remaining after gaps, avoiding percentage-plus-gap overflow. */
export function columnTracks(raw: unknown, count: number): string {
  const values = String(raw ?? '').split(/[,\s]+/).filter(Boolean).map(Number)
  const weights = values.length === count && values.every(value => Number.isFinite(value) && value > 0 && value <= 100) ? values : Array<number>(count).fill(1)
  return weights.map(value => `minmax(0,${value}fr)`).join(' ')
}

export function columnLayoutStyle(settings: Record<string, unknown>): string {
  const count = (value: unknown, fallback: number) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6 ? Number(value) : fallback
  const desktop = count(settings.perRow, 3), tablet = count(settings.tabletPerRow, Math.min(2, desktop)), mobile = count(settings.mobilePerRow, 1)
  return `--per:${desktop};--cols-desktop:${columnTracks(settings.columnWidths, desktop)};--cols-tablet:${columnTracks(settings.tabletColumnWidths, tablet)};--cols-mobile:${columnTracks(settings.mobileColumnWidths, mobile)}`
}
