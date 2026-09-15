import { readFileSync } from 'node:fs'

const icon = readFileSync(new URL('./assets/storemill-icon.png', import.meta.url))
const logo = readFileSync(new URL('./assets/storemill-logo.png', import.meta.url))
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="341 347 1320 1390"><style>@media(prefers-color-scheme:dark){image{filter:brightness(0) invert(1)}}</style><image width="2000" height="2000" href="data:image/png;base64,${icon.toString('base64')}"/></svg>`

/** Only these bundled files are public; paths never come from user input. */
export function brandAsset(path: string): { body: Buffer | string; type: string } | null {
  if (path === '/_brand/storemill-icon.png') return { body: icon, type: 'image/png' }
  if (path === '/_brand/storemill-logo.png') return { body: logo, type: 'image/png' }
  if (path === '/_brand/favicon.svg') return { body: favicon, type: 'image/svg+xml' }
  return null
}

export const brandHead = '<meta name="application-name" content="storemill"><link rel="icon" type="image/svg+xml" href="/_brand/favicon.svg">'

export function brandIcon(inverse = false): string {
  return `<svg class="storemill-art storemill-icon${inverse ? ' storemill-white' : ''}" viewBox="341 347 1320 1390" aria-hidden="true" focusable="false"><image width="2000" height="2000" href="/_brand/storemill-icon.png"/></svg>`
}

export function brandLogo(inverse = false): string {
  return `<img class="storemill-art storemill-wordmark${inverse ? ' storemill-white' : ''}" src="/_brand/storemill-logo.png" alt="storemill" width="2000" height="533">`
}

export const brandStyles = `.storemill-art{display:block;object-fit:contain;flex-shrink:0;filter:brightness(0)}.storemill-art.storemill-white{filter:brightness(0) invert(1)}.storemill-wordmark{width:128px;height:34px;max-width:100%}.storemill-icon{width:28px;height:30px}.storemill-home{display:flex;align-items:center;justify-content:flex-start;text-decoration:none}.storemill-home:focus-visible{outline:2px solid #8bb9ff;outline-offset:4px;border-radius:4px}.storemill-mobile-mark{display:none}.top .storemill-wordmark{width:114px;height:30px}.top .storemill-icon{width:24px;height:26px}.assistant-launcher .storemill-icon{width:26px;height:28px}.assistant-heading .storemill-icon{width:17px;height:19px}@media(max-width:600px){.top .storemill-wordmark{display:none}.storemill-mobile-mark{display:block}.top .storemill-home{min-width:24px}}`
