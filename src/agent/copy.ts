import { seedOf } from './images.ts'

/**
 * The rules writer.
 *
 * Scaffolding for a deployment with no model key, and the floor under the
 * tests: a defensible name, a coherent palette and three plausible products
 * derived from the sentence the owner typed — same sentence, same store,
 * every time. With a model configured, `agent/brand.ts` writes the kit and
 * only the palettes and fonts here are used.
 */

export type Palette = { primary: string; secondary: string; paper: string; ink: string; displayFont: string; bodyFont: string; mood: string }

export const PALETTES: Palette[] = [
  { mood: 'heritage', primary: '#7a4a2b', secondary: '#5d1f28', paper: '#f4ece1', ink: '#241a14', displayFont: "'Fraunces', Georgia, serif", bodyFont: "'Manrope', ui-sans-serif, system-ui, sans-serif" },
  { mood: 'clinical', primary: '#2f6f6a', secondary: '#123c39', paper: '#f6f8f7', ink: '#14201e', displayFont: "'Instrument Serif', Georgia, serif", bodyFont: "'DM Sans', ui-sans-serif, system-ui, sans-serif" },
  { mood: 'botanical', primary: '#4d6b3c', secondary: '#2c3f24', paper: '#f5f4ea', ink: '#1e2418', displayFont: "'Newsreader', Georgia, serif", bodyFont: "'Onest', ui-sans-serif, system-ui, sans-serif" },
  { mood: 'midnight', primary: '#3b3f7a', secondary: '#191b3d', paper: '#f2f2f7', ink: '#15162a', displayFont: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif", bodyFont: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" },
  { mood: 'sunbaked', primary: '#c2622c', secondary: '#7d2f18', paper: '#fbf1e5', ink: '#2b1a10', displayFont: "'Syne', ui-sans-serif, system-ui, sans-serif", bodyFont: "'Outfit', ui-sans-serif, system-ui, sans-serif" },
  { mood: 'monochrome', primary: '#2b2b2b', secondary: '#000000', paper: '#f7f7f5', ink: '#111111', displayFont: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif", bodyFont: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" },
  { mood: 'petal', primary: '#a8496b', secondary: '#5d2138', paper: '#fbf0f2', ink: '#2c161d', displayFont: "'Instrument Serif', Georgia, serif", bodyFont: "'Sora', ui-sans-serif, system-ui, sans-serif" },
]

export const MOODS: string[] = PALETTES.map((palette) => palette.mood)

const MOOD_WORDS: Array<[string, string[]]> = [
  ['heritage', ['heritage', 'leather', 'vintage', 'atelier', 'workshop', 'artisan', 'hand-stitched', 'boxing', 'barber', 'whisky', 'tobacco', '1920', 'classic', 'traditional']],
  ['clinical', ['skincare', 'serum', 'clinical', 'supplement', 'vitamin', 'lab', 'science', 'derm', 'clean', 'minimal', 'pharmacy', 'wellness']],
  ['botanical', ['tea', 'plant', 'botanical', 'herbal', 'garden', 'organic', 'farm', 'seed', 'coffee', 'honey', 'apothecary', 'candle']],
  ['midnight', ['tech', 'audio', 'gadget', 'gaming', 'electronics', 'night', 'studio', 'synth', 'developer', 'tool']],
  ['sunbaked', ['mexico', 'spain', 'desert', 'surf', 'ceramic', 'terracotta', 'hot sauce', 'taco', 'summer', 'travel', 'linen']],
  ['monochrome', ['streetwear', 'sneaker', 'denim', 'utility', 'workwear', 'gym', 'training', 'apparel', 'basics']],
  ['petal', ['jewelry', 'jewellery', 'floral', 'bridal', 'perfume', 'silk', 'lingerie', 'stationery', 'wedding']],
]

const NAME_HEADS = ['Iron', 'North', 'Ember', 'Field', 'Salt', 'Cedar', 'Atlas', 'Marrow', 'Wren', 'Kiln', 'Halcyon', 'Verge', 'Copper', 'Aster', 'Tallow', 'Quarry', 'Meridian', 'Fathom']
const NAME_TAILS = ['jaw', 'field', 'stone', 'craft', 'root', 'wick', 'forge', 'house', 'row', 'mark', 'well', 'shore']
const SUFFIXES = ['& Co.', 'Supply', 'Goods', 'Atelier', 'Works', 'Standard', 'Provisions', 'Studio']

export type Brief = {
  prompt: string
  category: string
  mood: string
  place: string
  material: string
  audience: string
}

const CATEGORIES: Array<[string, string[]]> = [
  ['boxing gear', ['boxing', 'glove', 'sparring', 'mma', 'fight']],
  ['skincare', ['skincare', 'serum', 'moisturiser', 'moisturizer', 'cleanser', 'face']],
  ['coffee', ['coffee', 'espresso', 'roast', 'bean']],
  ['tea', ['tea', 'matcha', 'infusion']],
  ['candles', ['candle', 'wax', 'wick', 'scent']],
  ['ceramics', ['ceramic', 'pottery', 'vase', 'stoneware', 'mug']],
  ['jewellery', ['jewelry', 'jewellery', 'ring', 'necklace', 'earring']],
  ['apparel', ['apparel', 'clothing', 'shirt', 'hoodie', 'tee', 'denim', 'streetwear']],
  ['footwear', ['sneaker', 'shoe', 'boot', 'footwear']],
  ['bags', ['bag', 'tote', 'backpack', 'luggage']],
  ['hot sauce', ['hot sauce', 'chilli', 'chili', 'salsa']],
  ['stationery', ['notebook', 'stationery', 'pen', 'journal', 'paper']],
  ['pet supplies', ['dog', 'cat', 'pet', 'collar', 'leash']],
  ['home goods', ['home', 'linen', 'blanket', 'towel', 'kitchen']],
  ['supplements', ['supplement', 'protein', 'vitamin', 'creatine']],
  ['audio', ['headphone', 'speaker', 'audio', 'turntable', 'vinyl']],
  ['bicycles', ['bike', 'bicycle', 'cycling']],
  ['watches', ['watch', 'horology', 'timepiece']],
]

const PLACES = ['Mexico City', 'Lisbon', 'Portland', 'Kyoto', 'Copenhagen', 'Marfa', 'Glasgow', 'Oaxaca', 'Bristol', 'Reykjavik']
const MATERIALS: Record<string, string> = {
  'boxing gear': 'full-grain leather',
  skincare: 'cold-pressed botanicals',
  coffee: 'single-origin beans',
  tea: 'whole-leaf harvests',
  candles: 'coconut-soy wax',
  ceramics: 'hand-thrown stoneware',
  jewellery: 'recycled 14k gold',
  apparel: 'heavyweight organic cotton',
  footwear: 'vegetable-tanned leather',
  bags: 'waxed canvas',
  'hot sauce': 'smoked chillies',
  stationery: 'cotton-rag paper',
  'pet supplies': 'bridle leather',
  'home goods': 'stonewashed linen',
  supplements: 'third-party tested actives',
  audio: 'machined aluminium',
  bicycles: 'butted steel',
  watches: 'sapphire and steel',
}

export function readBrief(prompt: string): Brief {
  const text = prompt.toLowerCase()
  const category = CATEGORIES.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? 'goods'
  const mood = MOOD_WORDS.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? PALETTES[seedOf(prompt) % PALETTES.length]?.mood ?? 'heritage'
  // Only a place the owner actually named. Hashing the prompt into a list of
  // cities invented a place of manufacture, and it was printed as a spec row,
  // in the announcement bar, in the shipping copy and in the proof points —
  // the one claim this platform says twice that it never makes.
  const place = PLACES.find((candidate) => text.includes(candidate.toLowerCase())) ?? ''
  const audience = /\b(men|women|kids|children|dogs|cats|athletes|runners|climbers)\b/.exec(text)?.[1] ?? 'people who care about the details'
  return { prompt, category, mood, place, material: MATERIALS[category] ?? 'materials chosen one at a time', audience }
}

export function paletteFor(brief: Brief): Palette {
  return PALETTES.find((palette) => palette.mood === brief.mood) ?? (PALETTES[0] as Palette)
}

/** Short, sayable, no "Shop" and no "Online". Two words at most. */
export function brandName(brief: Brief): string {
  const seed = seedOf(brief.prompt)
  // "called Marrow Lab with three products" names the brand "Marrow Lab", not
  // the rest of the sentence: a name is a run of capitalised words, at most four.
  const explicit = /(?:called|named)\s+"?([A-Z][A-Za-z0-9'.]*(?:\s+(?:&|[A-Z][A-Za-z0-9'.]*)){0,3})"?/.exec(brief.prompt)
  if (explicit?.[1]) return explicit[1].trim().replace(/\s+/g, ' ')
  const head = NAME_HEADS[seed % NAME_HEADS.length] as string
  const useCompound = seed % 3 !== 0
  // "Marrow" + "row" is not a name. Skip a tail that repeats the head's ending.
  let tailIndex = (seed >>> 3) % NAME_TAILS.length
  const clashes = (tail: string) => Array.from({ length: tail.length }, (_, k) => tail.slice(0, k + 1)).some((prefix) => head.toLowerCase().endsWith(prefix))
  while (clashes(NAME_TAILS[tailIndex] as string)) tailIndex = (tailIndex + 1) % NAME_TAILS.length
  const tail = NAME_TAILS[tailIndex] as string
  const suffix = SUFFIXES[(seed >>> 5) % SUFFIXES.length] as string
  return useCompound ? `${head}${tail} ${suffix}` : `${head} ${suffix}`
}

export function slogan(brief: Brief, name: string): string {
  const options = [
    brief.place ? `${capitalize(brief.material)}, made in ${brief.place}.` : `${capitalize(brief.material)}.`,
    `Built for ${brief.audience}.`,
    `${capitalize(brief.category)} that outlives the trend.`,
    `One thing, done properly.`,
  ]
  return options[seedOf(name) % options.length] as string
}

export function brandDescription(brief: Brief, name: string): string {
  return (
    `${name} makes ${brief.category} from ${brief.material}, in small runs${brief.place ? `, in ${brief.place}` : ''}. ` +
    `Everything is built to be repaired rather than replaced, priced so the maker is paid properly, ` +
    `and sold direct so nothing has to be padded to survive a wholesale margin.`
  )
}

export function brandVoice(brief: Brief): string {
  return `Plain, confident, specific. Names materials and process instead of adjectives. Never exclamatory. Assumes the reader knows something about ${brief.category}.`
}

export function announcement(brief: Brief): string {
  return brief.place ? `MADE IN ${brief.place.toUpperCase()} · FREE SHIPPING OVER $200` : 'FREE SHIPPING OVER $200'
}

/* --------------------------------------------------------------- the products */

export type DraftProduct = {
  title: string
  subtitle: string
  description: string
  priceCents: number
  options: Array<{ title: string; values: Array<{ value: string; swatch?: string; note?: string }> }>
  variantPlan: Array<{ combo: Record<string, string>; delta: number }>
  tags: string[]
  role: 'hero' | 'complement'
}

const SHAPES: Record<string, Array<{ noun: string; hero?: boolean; price: number; axis?: string; values?: string[] }>> = {
  'boxing gear': [
    { noun: 'Sparring Glove', hero: true, price: 34000, axis: 'Weight', values: ['12oz', '14oz', '16oz', '18oz'] },
    { noun: 'Hand Wrap', price: 3200, axis: 'Length', values: ['180in', '210in'] },
    { noun: 'Gym Holdall', price: 21000, axis: 'Size', values: ['Day', 'Week'] },
  ],
  skincare: [
    { noun: 'Barrier Serum', hero: true, price: 6800, axis: 'Size', values: ['15ml', '30ml', '50ml'] },
    { noun: 'Milk Cleanser', price: 3400, axis: 'Size', values: ['100ml', '200ml'] },
    { noun: 'Night Balm', price: 5200, axis: 'Size', values: ['30ml', '60ml'] },
  ],
  coffee: [
    { noun: 'House Roast', hero: true, price: 2200, axis: 'Grind', values: ['Whole bean', 'Filter', 'Espresso'] },
    { noun: 'Single Origin', price: 2600, axis: 'Grind', values: ['Whole bean', 'Filter'] },
    { noun: 'Travel Tin', price: 3800, axis: 'Size', values: ['250g', '500g'] },
  ],
  candles: [
    { noun: 'Signature Candle', hero: true, price: 5400, axis: 'Size', values: ['180g', '380g'] },
    { noun: 'Refill', price: 3400, axis: 'Size', values: ['180g', '380g'] },
    { noun: 'Wick Trimmer', price: 2400 },
  ],
  ceramics: [
    { noun: 'Everyday Mug', hero: true, price: 4200, axis: 'Glaze', values: ['Ash', 'Oxblood', 'Bone'] },
    { noun: 'Serving Bowl', price: 7800, axis: 'Glaze', values: ['Ash', 'Oxblood'] },
    { noun: 'Stem Vase', price: 6400, axis: 'Height', values: ['18cm', '26cm'] },
  ],
  apparel: [
    { noun: 'Heavyweight Tee', hero: true, price: 6500, axis: 'Size', values: ['S', 'M', 'L', 'XL'] },
    { noun: 'Boxy Hoodie', price: 14500, axis: 'Size', values: ['S', 'M', 'L', 'XL'] },
    { noun: 'Field Cap', price: 4500 },
  ],
}

const GENERIC: Array<{ noun: string; hero?: boolean; price: number; axis?: string; values?: string[] }> = [
  { noun: 'Everyday Edition', hero: true, price: 12000, axis: 'Size', values: ['Small', 'Medium', 'Large'] },
  { noun: 'Companion', price: 6400, axis: 'Finish', values: ['Natural', 'Black'] },
  { noun: 'Starter Set', price: 18000 },
]

const SWATCHES = ['#3b2a1e', '#8a5a33', '#c9b79c', '#1f1f1f', '#7d2f18', '#2f6f6a', '#f0e8db']

export function draftProducts(brief: Brief, brandLabel: string): DraftProduct[] {
  const shapes = SHAPES[brief.category] ?? GENERIC
  const colourAxis = {
    title: brief.category === 'coffee' || brief.category === 'skincare' ? 'Finish' : 'Colour',
    values: ['Natural', 'Black', 'Oxblood'].map((value, index) => ({ value, swatch: SWATCHES[index] as string })),
  }
  return shapes.map((shape, index) => {
    const title = `The ${shape.noun}`
    const options: DraftProduct['options'] = []
    if (shape.axis && shape.values) {
      options.push({ title: shape.axis, values: shape.values.map((value) => ({ value })) })
    }
    if (index === 0) options.push(colourAxis)

    const variantPlan: DraftProduct['variantPlan'] = []
    const primary = options[0]?.values ?? [{ value: 'Standard' }]
    const secondary = options[1]?.values ?? [null]
    primary.forEach((first, firstIndex) => {
      for (const second of secondary) {
        const combo: Record<string, string> = {}
        if (options[0]) combo[options[0].title] = first.value
        if (options[1] && second) combo[options[1].title] = second.value
        variantPlan.push({ combo, delta: firstIndex * Math.round(shape.price * 0.06) })
      }
    })

    return {
      title,
      subtitle: subtitleFor(brief, shape.noun),
      description: productCopy(brief, brandLabel, shape.noun),
      priceCents: shape.price,
      options,
      variantPlan,
      tags: [brief.category, brief.mood, index === 0 ? 'hero' : 'complement'],
      role: shape.hero ? 'hero' : 'complement',
    }
  })
}

function subtitleFor(brief: Brief, noun: string): string {
  const options = [
    `For real use, not for the shelf.`,
    `${capitalize(brief.material)}, cut and finished by hand.`,
    `The ${noun.toLowerCase()} we could not buy, so we made it.`,
  ]
  return options[seedOf(noun) % options.length] as string
}

/**
 * 150–200 words, structured the way a good DTC page reads: what it is, what it
 * is made of, how it behaves over time, and who it is not for. The last part
 * is what makes the rest believable.
 */
function productCopy(brief: Brief, brandLabel: string, noun: string): string {
  const parts = [
    `The ${noun} is the piece ${brandLabel} started with, and the one everything else has to sit alongside.`,
    `It is made from ${brief.material}${brief.place ? ` in a workshop in ${brief.place}` : ''}, in runs small enough that the person who assembled yours could tell you which batch it came from.`,
    `Nothing here is decorative. The stitching is doubled where the load actually goes, the edges are burnished rather than painted so they will not crack, and the hardware is oversized by a size because the failure point on cheap ${brief.category} is never the material, it is the fitting.`,
    `Expect it to look better in a year than it does in the photographs. ${capitalize(brief.material)} takes on the shape of the person using it, and the finish deepens where your hands sit.`,
    `It is not the cheapest option and it is not trying to be. If you replace your ${brief.category} every season because you like the change, buy something else and enjoy it. If you would rather buy once, repair twice, and stop thinking about it, this is the one.`,
    `Built to order in fourteen days. Repairs are handled in-house for as long as we are here.`,
  ]
  return parts.join(' ')
}

export function collectionPlan(brief: Brief): Array<{ title: string; description: string }> {
  return [
    { title: 'New arrivals', description: brief.place ? `The most recent work out of the ${brief.place} workshop.` : 'The most recent work.' },
    { title: 'The essentials', description: `If you are buying one thing from us, buy from here.` },
  ]
}

export function promotionPlan(): Array<{ title: string; kind: 'percentage' | 'free_shipping' | 'bundle'; value: number; code?: string; rules?: Record<string, unknown> }> {
  return [
    { title: 'Welcome offer', kind: 'percentage', value: 10, code: 'WELCOME10', rules: { firstOrderOnly: true } },
    { title: 'Free shipping over $200', kind: 'free_shipping', value: 0, rules: { minSubtotalCents: 20000 } },
    { title: 'Buy two, save 15%', kind: 'bundle', value: 15, rules: { buyQuantity: 2 } },
  ]
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

export { capitalize }
