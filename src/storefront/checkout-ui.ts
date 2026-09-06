import { escapeHtml as e } from '../lib/http.ts'
import type { Address, Brand } from '../domain/types.ts'

/** Keep the merchant's accent, choosing readable labels and links for light brands too. */
export function checkoutPalette(brand: Brand) {
  const hex = (value: string | undefined) => {
    if (/^#[\da-f]{6}$/i.test(value || '')) return value!.toLowerCase()
    if (/^#[\da-f]{3}$/i.test(value || '')) return '#' + [...value!.slice(1)].map(c => c + c).join('')
    return ''
  }
  const primary = hex(brand.primary) || '#1773b0'
  const luminance = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0)
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
  const preferred = hex(brand.buttonText)
  const text = preferred && contrast(primary, preferred) >= 4.5 ? preferred : contrast(primary, '#ffffff') >= 4.5 ? '#ffffff' : '#111111'
  let link = primary
  while (contrast(link, '#ffffff') < 4.5) link = '#' + [1, 3, 5].map(i => Math.floor(parseInt(link.slice(i, i + 2), 16) * .9).toString(16).padStart(2, '0')).join('')
  return { primary, text, link }
}

export function checkoutBrandCss(brand: Brand): string {
  const palette = checkoutPalette(brand)
  return `body.checkout-page{--co-accent:${palette.primary};--co-label:${palette.text};--co-link:${palette.link}}`
}

export const CHECKOUT_ICONS = {
  lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>',
  bag: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
}
export function checkoutField(name:string,label:string,value='',options:{required?:boolean;type?:string;autocomplete?:string;disabled?:boolean;ariaLabel?:string}={}):string {
  return `<div class="field co-field"><input id="co-${e(name)}" name="${e(name)}" type="${options.type||'text'}" placeholder=" " value="${e(value)}" ${options.required?'required':''} ${options.disabled?'disabled':''} autocomplete="${e(options.autocomplete||'off')}" aria-label="${e(options.ariaLabel||label)}"><label for="co-${e(name)}">${e(label)}</label></div>`
}
export function countryLabel(code:string):string {
  try{return new Intl.DisplayNames(['en'],{type:'region'}).of(code)||code}catch{return code}
}
export function addressFields(address:Address={},countries:string[]=[],billing=false):string {
  const prefix=billing?'billing':'',name=(key:string)=>prefix?prefix+key[0]!.toUpperCase()+key.slice(1):key;
  const field=(key:string,label:string,value='',required=false,autocomplete='')=>checkoutField(name(key),label,value,{required,ariaLabel:billing?'Billing '+label.toLowerCase():label,autocomplete:`${billing?'billing':'shipping'} ${autocomplete}`});
  const country=address.country||countries[0]||'US';
  return `<div class="field co-field co-select"><select id="co-${name('country')}" name="${name('country')}" autocomplete="${billing?'billing':'shipping'} country" aria-label="Country/Region">${[...new Set(countries.length?countries:[country])].map(code=>`<option value="${e(code)}" ${code===country?'selected':''}>${e(countryLabel(code))}</option>`).join('')}</select><label for="co-${name('country')}">Country/Region</label></div>
    <div class="two">${field('firstName','First name',address.name?.split(' ')[0]||'',true,'given-name')}${field('lastName','Last name',address.name?.split(' ').slice(1).join(' ')||'',true,'family-name')}</div>
    ${field('line1','Address',address.line1||'',true,'address-line1')}
    ${field('line2','Apartment, suite, etc. (optional)',address.line2||'',false,'address-line2')}
    <div class="co-locality">${field('city','City',address.city||'',true,'address-level2')}${field('state','State / province',address.state||'',false,'address-level1')}${field('postal','Postal code',address.postal||'',true,'postal-code')}</div>`
}

/** Checkout has its own neutral surfaces. A dark imported brand must never make fields illegible. */
export const CHECKOUT_CSS = `
body.checkout-page{--paper:#fff;--ink:#1a1a1a;--raise:#f5f5f5;--muted:#626262;--line:#dedede;--primary:var(--co-accent,#1773b0);--button-label:#fff;--radius:6px;--body:Arial,Helvetica,sans-serif;--display:var(--body);--body-weight:400;background:#fff;color:#1a1a1a;font:400 14px/1.5 var(--body);color-scheme:light}
.checkout-page #main{background:linear-gradient(to right,#fff 0,#fff calc(50% + 77px),#f5f5f5 calc(50% + 77px),#f5f5f5 100%)}
.checkout-page .blk--checkout-form{padding:0;background:transparent;text-align:left}
.checkout-page .blk--checkout-form>.blk-in{width:100%;max-width:none;margin:0}
.checkout-page .checkout{width:min(1100px,calc(100% - 80px));margin:0 auto;grid-template-columns:minmax(0,57fr) minmax(0,43fr);gap:0;min-height:calc(100vh - 108px);align-items:start}
.checkout-page .co-main{padding:38px 40px 44px 0;max-width:none;justify-self:stretch}
.checkout-page .co-side{padding:38px 0 40px 40px;border:0;border-left:1px solid #dedede;border-radius:0;background:#f5f5f5;position:sticky;top:0;max-height:100vh;height:auto;overflow:auto;align-self:start;min-height:480px}
.checkout-page .co-header{background:#fff;border-bottom:1px solid #dedede}
.checkout-page .co-header-in{width:min(1100px,calc(100% - 80px));margin:auto;min-height:90px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.checkout-page .co-logo{margin:0;font:500 24px/1.2 var(--body);letter-spacing:.045em;text-decoration:none;color:#222}
.checkout-page .co-logo img{max-width:190px;max-height:96px;width:auto;height:auto;object-fit:contain}
.checkout-page .co-header-actions{display:flex;align-items:center;gap:20px}.checkout-page .co-header-secure{display:flex;align-items:center;gap:6px;color:#626262;font-size:12px;white-space:nowrap}.checkout-page .co-header-secure svg{flex:none}
.checkout-page .co-cart-link{display:grid;place-items:center;width:44px;height:44px;color:var(--co-link,#1773b0)}
.checkout-page .co-block{padding:0;margin:0 0 30px}
.checkout-page .co-block:empty{display:none}
.checkout-page .co-block h2{font:600 21px/1.3 var(--body);letter-spacing:0;margin:0 0 14px}
.checkout-page .co-block h3{font:600 16px/1.4 var(--body);margin:20px 0 12px}
.checkout-page .co-h{font:600 15px/1.4 var(--body);margin:0 0 18px}
.checkout-page .micro{color:#626262;font-size:13px;line-height:1.5}
.checkout-page .co-field{position:relative;display:block;margin:0 0 12px}
.checkout-page .co-field input,.checkout-page .co-field select{width:100%;height:52px;padding:21px 12px 6px;background:#fff;color:#1a1a1a;border:1px solid #b5b5b5;border-radius:6px;font:400 14px/1.4 var(--body);box-shadow:none}
.checkout-page .co-field label{position:absolute;left:13px;top:7px;pointer-events:none;color:#616161;font:400 11px/1.2 var(--body);letter-spacing:0;text-transform:none;transition:transform .12s,top .12s,font-size .12s}
.checkout-page .co-field input:placeholder-shown:not(:focus)+label{top:17px;font-size:14px}
.checkout-page .co-field input:focus,.checkout-page .co-field select:focus{outline:2px solid var(--co-link,#1773b0);outline-offset:-1px;border-color:var(--co-link,#1773b0)}
.checkout-page .co-field input[aria-invalid=true]{border-color:#c5280c;outline-color:#c5280c}
.checkout-page .co-field .field-error{display:block;color:#c5280c;font-size:12px;margin-top:5px}
.checkout-page .co-select select{appearance:auto;padding-right:28px}
.checkout-page .two{gap:12px;grid-template-columns:1fr 1fr}
.checkout-page .co-locality{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.checkout-page .check{font-size:14px;line-height:1.5;color:#333;gap:10px;margin-top:5px;cursor:pointer}
.checkout-page input[type=checkbox],.checkout-page input[type=radio]{width:18px;height:18px;accent-color:var(--co-link,#1773b0);margin:0;flex-shrink:0}
.checkout-page .methods{gap:0;border:1px solid #b5b5b5;border-radius:6px;overflow:hidden}
.checkout-page .method{min-height:56px;border:0;border-bottom:1px solid #dedede;border-radius:0;padding:15px 14px;background:#fff;gap:10px;font-size:14px}
.checkout-page .method:last-child{border-bottom:0}
.checkout-page .method:has(input:checked){background:color-mix(in srgb,var(--co-accent,#1773b0) 7%,#fff);box-shadow:inset 0 0 0 1px var(--co-link,#1773b0);border-radius:5px}
.checkout-page .method b{font-size:14px;font-weight:600;white-space:nowrap}
.checkout-page .pay-description{margin:-9px 0 16px}
.checkout-page .pay-demo{padding:0;border:1px solid #b5b5b5;border-radius:6px;background:#f5f5f5;overflow:hidden}
.checkout-page .pay-demo .row{padding:15px 14px;background:color-mix(in srgb,var(--co-accent,#1773b0) 7%,#fff);border-bottom:1px solid #b5b5b5;gap:12px}
.checkout-page .pay-demo .row strong{font-size:14px;font-weight:500;display:flex;gap:9px;align-items:center}
.checkout-page .cards{display:flex;gap:4px;align-items:center;flex-shrink:0}
.checkout-page .cards i{display:grid;place-items:center;margin:0;width:34px;height:23px;border:1px solid #dedede;font:bold 9px Arial;background:#fff;color:#15317a;letter-spacing:0;padding:0}
.checkout-page .cards .mc{position:relative;overflow:hidden;color:transparent}
.checkout-page .cards .mc:before,.checkout-page .cards .mc:after{content:'';width:13px;height:13px;border-radius:50%;background:#eb001b;position:absolute;left:6px}
.checkout-page .cards .mc:after{background:#f79e1b;left:15px;opacity:.85}
.checkout-page .co-card-preview{padding:14px 14px 2px}
.checkout-page .co-card-preview .co-field{margin-bottom:12px}
.checkout-page .co-card-preview input:disabled{opacity:1;-webkit-text-fill-color:#707070;background:#fff}
.checkout-page .co-preview-note{padding:0 14px 14px;margin:0;color:#626262;font-size:12px}
.checkout-page [data-address-fallback][hidden],.checkout-page [data-address-element][hidden]{display:none!important}
.checkout-page .co-address-switch{border:0;background:none;padding:4px 0;color:var(--co-link,#1773b0);font:400 12px var(--body);text-decoration:underline;cursor:pointer;margin-bottom:12px}.checkout-page .co-address-help{font-size:12px;color:#626262;margin:4px 0 12px}
.checkout-page .co-billing{border:0;padding:16px 0 0;margin:0;min-width:0}
.checkout-page .co-billing[hidden]{display:none}
.checkout-page .pay{margin:2px 0 0;min-height:56px;border:1px solid var(--co-accent,#1773b0);border-radius:6px;background:var(--co-accent,#1773b0);color:var(--co-label,#fff);font:600 17px/1.3 var(--body);letter-spacing:0;text-transform:none;gap:5px;box-shadow:none}
.checkout-page .pay:hover{background:color-mix(in srgb,var(--co-accent,#1773b0) 92%,var(--co-label,#fff));border-color:var(--co-accent,#1773b0)}
.checkout-page .pay:disabled{cursor:default;opacity:.75}
.checkout-page .co-footer{padding-top:24px;margin-top:36px;border-top:1px solid #dedede;display:flex;flex-wrap:wrap;gap:10px 18px;font-size:12px}
.checkout-page .co-footer a{color:var(--co-link,#1773b0);text-underline-offset:2px}
.checkout-page .co-secure{display:flex;gap:6px;align-items:center;justify-content:center;font-size:12px;color:#626262;margin:14px 0 0}
.checkout-page .co-error{color:#a5220b;font-size:13px;line-height:1.5;margin:10px 0}
.checkout-page .co-error:empty{display:none}
.checkout-page .co-sample{border:0;background:none;padding:0;font-size:12px;color:#626262;margin:0 0 20px}
.checkout-page .summary-body{font-size:14px}
.checkout-page .summary-body .lines{border-collapse:separate;border-spacing:0 0;width:100%;table-layout:auto}
.checkout-page .summary-body .lines td{border:0;padding:0 0 18px;vertical-align:middle}
.checkout-page .summary-body .lines td:first-child{width:80px!important;padding-right:16px}
.checkout-page .summary-body .lines td:nth-child(2){font-size:14px;line-height:1.4;overflow-wrap:anywhere}
.checkout-page .summary-body .lines td:last-child{font-size:14px;font-weight:500;white-space:nowrap;padding-left:16px}
.checkout-page .summary-body .lines td:last-child s{display:block;font-weight:400}
.checkout-page .thumb{width:64px;height:64px;vertical-align:middle}
.checkout-page .thumb img{width:64px;height:64px;object-fit:contain;border-radius:8px;border:1px solid #d7d7d7;background:white}
.checkout-page .thumb b{width:22px;height:22px;background:#707070;color:#fff;font:500 12px/1 var(--body);top:-8px;right:-8px}
.checkout-page .code{display:flex;align-items:flex-start;gap:12px;margin:6px 0 0}
.checkout-page .code .co-field{flex:1;min-width:0}
.checkout-page .code button{height:52px;min-height:52px;padding:0 18px;background:#ededed;color:#444;border:1px solid #d3d3d3;border-radius:6px;font:600 14px var(--body);text-transform:none;letter-spacing:0}
.checkout-page .code button:hover{background:#e4e4e4}
.checkout-page .co-code-chip{display:inline-flex;gap:9px;align-items:center;background:#e8e8e8;padding:5px 9px;border-radius:4px;margin-bottom:12px;font-size:12px}
.checkout-page .co-code-chip button{border:0;background:none;padding:0;min-width:24px;min-height:24px;color:#333;font-size:20px;cursor:pointer}
.checkout-page .totals{margin:12px 0 0;width:100%;max-width:none}
.checkout-page .totals>div{padding:5px 0;gap:20px;line-height:1.45}
.checkout-page .totals .grand{border:0;margin-top:12px;padding-top:4px;font-size:20px;font-weight:600}
.checkout-page .totals .grand span:last-child:before{content:attr(data-currency);font-size:12px;color:#626262;font-weight:400;margin-right:8px}
.checkout-page .express{margin:0 0 28px}
.checkout-page .express .eyebrow{text-align:center;font:400 13px/1.5 var(--body);letter-spacing:0;text-transform:none;margin-bottom:13px;color:#626262}
.checkout-page .co-wallet-preview{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.checkout-page .co-wallet-preview button{height:48px;border-radius:5px;border:0;font:500 clamp(16px,4.8vw,19px) Arial;letter-spacing:-.4px;opacity:1;white-space:nowrap;padding:0 8px}.checkout-page .co-wallet-apple{background:#000;color:#fff}.checkout-page .co-wallet-google{background:#fff;color:#333;box-shadow:inset 0 0 0 1px #d5d5d5}.checkout-page .co-wallet-google b{color:#4285f4}.checkout-page .co-wallet-link{background:#32df9c;color:#072f23;font-weight:700!important}.checkout-page .co-wallet-link span{margin-left:8px}.checkout-page .co-preview-label{font-size:10px;border:1px solid #d5d5d5;border-radius:3px;padding:2px 4px;margin-left:5px}.checkout-page .co-wallet-help{font-size:11px;color:#626262;text-align:center;margin:8px 0 0;max-width:none}
.checkout-page .express .or{font-size:12px;text-transform:uppercase;margin-top:20px}
.checkout-page .co-summary-mobile{display:none}
.checkout-page .checkout--stacked{grid-template-columns:1fr;max-width:620px}
.checkout-page .checkout--stacked .co-main{padding-right:0}
.checkout-page .bump{border:1px solid #b5b5b5;border-radius:6px;background:#fff;font-size:14px}
@media(min-width:1000px){.checkout-page .co-summary-mobile{display:none!important}}
@media(max-width:999px){
.checkout-page #main{background:#fff}
.checkout-page .co-header-in{width:min(560px,calc(100% - 40px));min-height:78px}
.checkout-page .co-header-actions{gap:4px}.checkout-page .co-header-secure{font-size:11px;gap:4px}.checkout-page .co-header-in{gap:12px}
.checkout-page .co-logo{font-size:22px;min-width:0;flex:1}.checkout-page .co-logo img{max-height:78px;max-width:min(150px,100%)}.checkout-page .co-header-actions{flex-shrink:0}
.checkout-page .checkout{width:min(560px,calc(100% - 40px));display:block;min-height:0}
.checkout-page .co-main{padding:0 0 32px;max-width:none}.checkout-page .co-side{display:none}
.checkout-page .co-summary-mobile{display:block;border:0;border-bottom:1px solid #dedede;border-radius:0;background:#f5f5f5;margin:0 calc((min(560px,100vw - 40px) - 100vw)/2) 28px;padding:0 max(20px,calc((100vw - 560px)/2))}
.checkout-page .co-summary-mobile summary{min-height:64px;align-items:center;font-size:14px;color:var(--co-link,#1773b0);gap:12px}
.checkout-page .co-summary-mobile summary::-webkit-details-marker{display:none}
.checkout-page .co-summary-mobile summary span:after{content:'⌄';display:inline-block;margin-left:8px;font-size:17px}.checkout-page .co-summary-mobile[open] summary span:after{transform:rotate(180deg)}
.checkout-page .co-summary-mobile summary b{font-size:19px;color:#1a1a1a;font-weight:600}
.checkout-page .co-summary-mobile .summary-body{padding:15px 0 24px}
.checkout-page .co-block{margin-bottom:28px}.checkout-page .co-block h2{font-size:21px}
.checkout-page .co-field input,.checkout-page .co-field select{font-size:16px}
.checkout-page .co-locality{grid-template-columns:1fr 1fr}.checkout-page .co-locality>.field:first-child{grid-column:1/-1}
.checkout-page .co-sample{padding-top:20px}.checkout-page .co-footer{margin-top:28px;gap:12px 16px}
.checkout-page .checkout--stacked .co-main{padding-top:28px}
}
@media(prefers-reduced-motion:reduce){.checkout-page *{transition:none!important}}
`;
