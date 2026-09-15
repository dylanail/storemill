import { createHash } from 'node:crypto'
import { escapeHtml } from '../lib/http.ts'
import { readUpload, saveUpload, uploadAsDataUri } from '../lib/uploads.ts'

/**
 * Product and brand imagery.
 *
 * With an image model configured, `generate()` calls it. Without one, it draws
 * a deterministic vector composition from the brand palette instead of showing
 * a grey box: a generated store has to *look* like a store the moment it
 * exists, and a placeholder rectangle is the difference between a demo that
 * lands and one that does not. The seed is a hash of the subject, so the same
 * product always gets the same picture across restarts.
 */
export const PRESETS = [
  { id: 'white-seamless', name: 'White seamless', brief: 'centred on a seamless white sweep, soft top light, no props' },
  { id: 'lifestyle', name: 'Lifestyle', brief: 'in use, natural window light, shallow depth of field' },
  { id: 'dark-luxury', name: 'Dark luxury', brief: 'on a dark stone plinth, single hard light, deep falloff' },
  { id: 'flat-lay', name: 'Flat lay', brief: 'overhead on linen with two supporting objects' },
  { id: 'golden-hour', name: 'Golden hour', brief: 'outdoors, low warm sun, long shadow' },
  { id: 'studio-3-point', name: 'Studio 3-point', brief: 'key, fill and rim light, seamless mid-grey' },
] as const

export type PresetId = (typeof PRESETS)[number]['id']

export type ImageRequest = {
  subject: string
  preset?: PresetId
  palette?: { primary?: string; secondary?: string; paper?: string; ink?: string }
  label?: string
  kind?: 'product' | 'hero' | 'logo' | 'collection'
  /** An upload URL (`/_uploads/...`). The output is derived from this photo. */
  reference?: string
}

export function seedOf(input: string): number {
  return parseInt(createHash('sha256').update(input).digest('hex').slice(0, 8), 16)
}

/** A stable URL the storefront and admin can both render without storage. */
export function imageUrl(request: ImageRequest): string {
  const params = new URLSearchParams({
    s: String(seedOf(request.subject)),
    k: request.kind ?? 'product',
    p: request.preset ?? 'white-seamless',
    l: (request.label ?? request.subject).slice(0, 40),
  })
  if (request.palette?.primary) params.set('c1', request.palette.primary)
  if (request.palette?.secondary) params.set('c2', request.palette.secondary)
  if (request.palette?.paper) params.set('c3', request.palette.paper)
  if (request.palette?.ink) params.set('c4', request.palette.ink)
  if (request.reference) params.set('ref', request.reference)
  return `/_media/render.svg?${params.toString()}`
}

/**
 * Four lanes in parallel, a contact sheet back. That is the enhancement flow:
 * you do not pick between "the" enhanced image and the original, you pick from
 * a sheet — which is the only way the choice is actually yours.
 */
export async function enhance(request: ImageRequest & { lanes?: number }): Promise<{ lanes: string[]; preset: string; tookMs: number }> {
  const started = Date.now()
  const lanes = request.lanes ?? 4
  const urls = await Promise.all(
    Array.from({ length: lanes }, (_, lane) =>
      generate({ ...request, subject: `${request.subject}#${lane}` }),
    ),
  )
  return { lanes: urls, preset: request.preset ?? 'white-seamless', tookMs: Date.now() - started }
}

/* ------------------------------------------------------------- providers */

/**
 * Two model families, plus the vector stage.
 *
 * OpenAI's GPT Image 2.5 Sunburst and Google's Gemini 3
 * Pro Image ("Nano Banana Pro") are both wired directly, with no SDK. Which
 * one runs is a choice per request; the default is whichever has a key, and
 * the vector stage is what you get with neither. The model ids are overridable
 * so a newer snapshot is one environment variable away, not a code change.
 */
export type ImageProvider = 'openai' | 'google' | 'svg'

export type ImageModel = { id: ImageProvider; name: string; model: string; envKey: string; note: string }

export function imageModels(): Array<ImageModel & { available: boolean }> {
  const openaiModel = process.env.STOREMILL_IMAGE_MODEL ?? process.env.AMBORAS_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst'
  const models: ImageModel[] = [
    { id: 'openai', name: openaiModel === 'gpt-image-2.5-sunburst' ? 'OpenAI GPT Image 2.5 Sunburst' : `OpenAI · ${openaiModel}`, model: openaiModel, envKey: 'OPENAI_API_KEY', note: 'Precise image editing, similar variations, text changes and product branding.' },
    { id: 'google', name: 'Google Gemini 3 Pro Image', model: process.env.STOREMILL_GOOGLE_IMAGE_MODEL ?? process.env.AMBORAS_GOOGLE_IMAGE_MODEL ?? 'gemini-3-pro-image-preview', envKey: 'GEMINI_API_KEY', note: 'Nano Banana Pro. Keeps the product identity across shots; good at lifestyle composites.' },
    { id: 'svg', name: 'Vector stage (no key)', model: 'built-in', envKey: '', note: 'Your photo staged into the scene deterministically. Always available.' },
  ]
  return models.map((entry) => ({ ...entry, available: entry.id === 'svg' || Boolean(process.env[entry.envKey]) }))
}

export function defaultProvider(): ImageProvider {
  const wanted = (process.env.STOREMILL_IMAGE_PROVIDER ?? process.env.AMBORAS_IMAGE_PROVIDER) as ImageProvider | undefined
  const models = imageModels()
  if (wanted && models.find((entry) => entry.id === wanted)?.available) return wanted
  return models.find((entry) => entry.available)?.id ?? 'svg'
}

export type ImageTransport = (url: string, init: RequestInit) => Promise<Response>
let transport: ImageTransport = (url, init) => fetch(url, init)
/** Tests swap the network out; nothing else should. */
export function useImageTransport(next: ImageTransport | null) {
  transport = next ?? ((url, init) => fetch(url, init))
}

export type GenerateRequest = ImageRequest & {
  provider?: ImageProvider
  /** Free-form: "on marble, morning light, a hand holding it, no props". */
  direction?: string
  /** When set, model output is saved as an upload under this store instead of a data URI. */
  storeId?: string
}

/** The prompt both models get. The direction is quoted verbatim; it is the merchant's call. */
export function imagePrompt(request: GenerateRequest): string {
  const preset = PRESETS.find((entry) => entry.id === (request.preset ?? 'white-seamless'))
  const base = `Commercial ${request.kind === 'hero' ? 'brand hero' : 'product'} photograph of ${request.subject}, ${preset?.brief ?? ''}.`
  const direction = request.direction?.trim() ? ` Art direction from the merchant: ${request.direction.trim()}.` : ''
  const identity = request.reference ? ' Keep this exact product: its shape, colour, label and details must not change; only the scene, light and styling change.' : ''
  return `${base}${direction}${identity} No added text, no watermark, no logos that are not on the product.`
}

/**
 * With a reference photo and an image model, the model *edits* the merchant's
 * own photograph into the scene, so the product in the output is the
 * product they sell and not a plausible stranger. Without a model, the same
 * photo is composed into the scene with a ground, a shadow and the brand's
 * light — a real change the merchant can see, made from their real product.
 */
export async function generate(request: GenerateRequest): Promise<string> {
  const provider = request.provider ?? defaultProvider()
  if (provider === 'svg') return imageUrl(request)
  const model = imageModels().find((entry) => entry.id === provider)
  const apiKey = model ? process.env[model.envKey] : undefined
  if (!model || !apiKey) return imageUrl(request)
  const prompt = imagePrompt(request)
  const referenceFile = request.reference ? readUpload(request.reference) : null
  try {
    const output = provider === 'openai' ? await openaiImage(apiKey, model.model, prompt, referenceFile) : await googleImage(apiKey, model.model, prompt, referenceFile)
    if (!output) return imageUrl(request)
    return persist(output, request.storeId)
  } catch {
    return imageUrl(request)
  }
}

type ImageOutput = { url?: string; bytes?: Buffer; type?: string }

async function openaiImage(apiKey: string, model: string, prompt: string, reference: { data: Buffer; type: string } | null): Promise<ImageOutput | null> {
  let response: Response
  if (reference) {
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', prompt)
    form.set('size', '1024x1024')
    form.set('image', new Blob([new Uint8Array(reference.data)], { type: reference.type }), 'reference.png')
    response = await transport('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
  } else {
    response = await transport('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', n: 1 }),
    })
  }
  if (!response.ok) return null
  const payload = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> }
  const first = payload.data?.[0]
  if (first?.b64_json) return { bytes: Buffer.from(first.b64_json, 'base64'), type: 'image/png' }
  if (first?.url) return { url: first.url }
  return null
}

/**
 * Gemini image models answer `generateContent` with image parts. The reference
 * photo goes in as inline data ahead of the prompt, which is how the model is
 * told to keep the subject rather than reinvent it.
 */
async function googleImage(apiKey: string, model: string, prompt: string, reference: { data: Buffer; type: string } | null): Promise<ImageOutput | null> {
  const parts: Array<Record<string, unknown>> = []
  if (reference) parts.push({ inline_data: { mime_type: reference.type, data: reference.data.toString('base64') } })
  parts.push({ text: prompt })
  const response = await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }),
  })
  if (!response.ok) return null
  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }> }
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData ?? (part.inline_data ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data } : undefined)
      if (inline?.data) return { bytes: Buffer.from(inline.data, 'base64'), type: inline.mimeType ?? 'image/png' }
    }
  }
  return null
}

/**
 * Model output is saved as an upload the moment it exists. A remote URL from a
 * provider expires within the hour, and a multi-megabyte data URI inside a
 * product row is a page that never loads; a file under `/_uploads` is neither.
 */
function persist(output: ImageOutput, storeId?: string): string {
  if (output.bytes) {
    if (storeId) {
      try {
        return saveUpload({ name: 'generated.png', type: output.type ?? 'image/png', data: output.bytes }, storeId).url
      } catch {
        /* fall through to the data URI */
      }
    }
    return `data:${output.type ?? 'image/png'};base64,${output.bytes.toString('base64')}`
  }
  return output.url ?? ''
}

/* --------------------------------------------------------------- vector draw */

type Palette = { primary: string; secondary: string; paper: string; ink: string }

function rng(seed: number) {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 10000) / 10000
  }
}

function mix(a: string, b: string, amount: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '')
    const full = clean.length === 3 ? clean.split('').map((character) => character + character).join('') : clean
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16))
  }
  const [r1, g1, b1] = parse(a) as [number, number, number]
  const [r2, g2, b2] = parse(b) as [number, number, number]
  const channel = (x: number, y: number) => Math.round(x + (y - x) * amount).toString(16).padStart(2, '0')
  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`
}

/** Renders the composition for an `imageUrl()` back into SVG. */
export function renderSvg(params: URLSearchParams): string {
  const seed = Number(params.get('s') ?? 1)
  const kind = params.get('k') ?? 'product'
  const preset = params.get('p') ?? 'white-seamless'
  const label = params.get('l') ?? ''
  const palette: Palette = {
    primary: params.get('c1') ?? '#7a4a2b',
    secondary: params.get('c2') ?? '#5d1f28',
    paper: params.get('c3') ?? '#f3ece3',
    ink: params.get('c4') ?? '#1a1a1a',
  }
  const random = rng(seed)
  const dark = preset === 'dark-luxury'
  const reference = params.get('ref')
  if (reference && kind !== 'logo') {
    const composed = composeReference(reference, preset, palette, kind, seed)
    if (composed) return composed
  }
  // A hero is a brand surface, not a product cut-out: it takes the brand's own
  // ground so the headline scrim over it reads as deliberate rather than grey.
  const ground =
    kind === 'hero'
      ? mix(palette.paper, palette.primary, 0.26)
      : dark
        ? mix(palette.ink, '#000000', 0.35)
        : preset === 'white-seamless'
          ? '#f7f4f0'
          : mix(palette.paper, palette.primary, 0.12)
  const warm = preset === 'golden-hour'

  const shapes: string[] = []
  if (kind === 'logo') {
    const initials = label.split(/\s+/).map((word) => word[0] ?? '').join('').slice(0, 2).toUpperCase()
    return svg(
      512,
      512,
      `<rect width="512" height="512" fill="${palette.primary}"/>
       <circle cx="256" cy="256" r="186" fill="none" stroke="${mix(palette.paper, '#ffffff', 0.4)}" stroke-width="6" opacity=".55"/>
       <text x="256" y="256" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif"
             font-size="188" letter-spacing="6" fill="${palette.paper}">${escapeHtml(initials)}</text>`,
    )
  }

  const width = kind === 'hero' ? 1600 : 1024
  const height = kind === 'hero' ? 900 : 1024
  shapes.push(`<rect width="${width}" height="${height}" fill="${ground}"/>`)
  shapes.push(
    `<radialGradient id="g" cx="${warm ? '78%' : '50%'}" cy="${warm ? '22%' : '34%'}" r="72%">
       <stop offset="0" stop-color="${mix(ground, warm ? '#ffd9a0' : '#ffffff', dark ? 0.18 : 0.55)}"/>
       <stop offset="1" stop-color="${ground}"/></radialGradient>
     <rect width="${width}" height="${height}" fill="url(#g)"/>`,
  )

  const centreX = width / 2
  const centreY = height * (kind === 'hero' ? 0.56 : 0.52)
  const scale = kind === 'hero' ? 1.15 : 1
  const bodyColor = mix(palette.primary, palette.secondary, 0.35 + random() * 0.3)

  // A soft contact shadow under the subject does most of the work of making a
  // flat composition read as a photograph of an object on a surface.
  shapes.push(
    `<ellipse cx="${centreX}" cy="${centreY + 210 * scale}" rx="${250 * scale}" ry="${34 * scale}" fill="${dark ? '#000' : palette.ink}" opacity="${dark ? 0.55 : 0.14}"/>`,
  )

  const petals = 3 + Math.floor(random() * 3)
  for (let index = 0; index < petals; index++) {
    const angle = (index / petals) * Math.PI * 2 + random()
    const offsetX = centreX + Math.cos(angle) * 96 * scale * (0.4 + random() * 0.6)
    const offsetY = centreY + Math.sin(angle) * 62 * scale * (0.4 + random() * 0.6)
    const radiusX = (110 + random() * 92) * scale
    const radiusY = (150 + random() * 110) * scale
    shapes.push(
      `<ellipse cx="${offsetX.toFixed(1)}" cy="${offsetY.toFixed(1)}" rx="${radiusX.toFixed(1)}" ry="${radiusY.toFixed(1)}"
        fill="${mix(bodyColor, index % 2 ? '#ffffff' : palette.ink, 0.1 + index * 0.07)}" opacity="${(0.82 - index * 0.09).toFixed(2)}"
        transform="rotate(${((random() - 0.5) * 34).toFixed(1)} ${offsetX.toFixed(1)} ${offsetY.toFixed(1)})"/>`,
    )
  }

  shapes.push(
    `<ellipse cx="${centreX - 62 * scale}" cy="${centreY - 96 * scale}" rx="${52 * scale}" ry="${86 * scale}"
       fill="#ffffff" opacity="${dark ? 0.12 : 0.3}" transform="rotate(-18 ${centreX} ${centreY})"/>`,
  )

  // Only collection art carries a word. A hero already has the theme's
  // headline laid over it, and two wordmarks in one image is a mistake you
  // only see once it is rendered.
  if (label && kind === 'collection') {
    shapes.push(
      `<text x="${centreX}" y="${height * 0.14}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
         font-size="${Math.round(width * 0.052)}" letter-spacing="${Math.round(width * 0.012)}" fill="${dark ? palette.paper : palette.ink}"
         opacity=".9">${escapeHtml(label.toUpperCase())}</text>`,
    )
  }

  // Fine grain keeps large flat fills from banding on wide gamut displays.
  shapes.push(
    `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 100}"/>
       <feColorMatrix type="saturate" values="0"/></filter>
     <rect width="${width}" height="${height}" filter="url(#grain)" opacity="${dark ? 0.07 : 0.05}"/>`,
  )

  return svg(width, height, shapes.join('\n'))
}

/**
 * The merchant's photograph, staged.
 *
 * The photo is embedded as-is — never redrawn, never "improved" — and the scene
 * is built around it: a ground that matches the preset, a contact shadow that
 * makes it sit on something, a light that matches the brand. Six presets, six
 * scenes, one honest product.
 */
function composeReference(reference: string, preset: string, palette: Palette, kind: string, seed: number): string | null {
  const dataUri = uploadAsDataUri(reference)
  if (!dataUri) return null
  const width = kind === 'hero' ? 1600 : 1024
  const height = kind === 'hero' ? 900 : 1024
  const dark = preset === 'dark-luxury'
  const warm = preset === 'golden-hour'
  const flat = preset === 'flat-lay'
  const ground =
    kind === 'hero'
      ? mix(palette.paper, palette.primary, 0.26)
      : dark
        ? mix(palette.ink, '#000000', 0.4)
        : preset === 'white-seamless'
          ? '#f7f4f0'
          : preset === 'studio-3-point'
            ? '#d9d6d1'
            : flat
              ? mix(palette.paper, '#ffffff', 0.25)
              : mix(palette.paper, palette.primary, 0.1)
  const inset = kind === 'hero' ? 0.18 : preset === 'lifestyle' ? 0.16 : 0.12
  const boxW = Math.round(width * (1 - inset * 2))
  const boxH = Math.round(height * (1 - inset * 2) * (kind === 'hero' ? 0.9 : 0.86))
  const boxX = Math.round((width - boxW) / 2)
  const boxY = Math.round((height - boxH) / 2 - (flat ? 0 : height * 0.03))
  const tilt = flat ? ((seed % 7) - 3) * 1.2 : 0
  const shadowY = boxY + boxH + (flat ? 6 : 14)
  return svg(
    width,
    height,
    `<rect width="${width}" height="${height}" fill="${ground}"/>
     <radialGradient id="g" cx="${warm ? '80%' : '50%'}" cy="${warm ? '18%' : '30%'}" r="75%">
       <stop offset="0" stop-color="${mix(ground, warm ? '#ffd9a0' : '#ffffff', dark ? 0.16 : 0.5)}"/>
       <stop offset="1" stop-color="${ground}"/></radialGradient>
     <rect width="${width}" height="${height}" fill="url(#g)"/>
     ${dark ? `<rect x="0" y="${Math.round(height * 0.72)}" width="${width}" height="${height}" fill="${mix(palette.ink, '#000', 0.6)}" opacity=".9"/>` : ''}
     <filter id="soft"><feGaussianBlur stdDeviation="${flat ? 10 : 22}"/></filter>
     <ellipse cx="${width / 2}" cy="${shadowY}" rx="${Math.round(boxW * 0.42)}" ry="${flat ? 18 : 30}" fill="${dark ? '#000' : palette.ink}" opacity="${dark ? 0.7 : 0.22}" filter="url(#soft)"/>
     <g transform="rotate(${tilt} ${width / 2} ${height / 2})">
       <image href="${dataUri}" x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" preserveAspectRatio="xMidYMid meet"/>
     </g>
     ${warm ? `<rect width="${width}" height="${height}" fill="#ffb86b" opacity=".12" style="mix-blend-mode:multiply"/>` : ''}
     <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 100}"/><feColorMatrix type="saturate" values="0"/></filter>
     <rect width="${width}" height="${height}" filter="url(#grain)" opacity="${dark ? 0.06 : 0.035}"/>`,
  )
}

function svg(width: number, height: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${inner}</svg>`
}
