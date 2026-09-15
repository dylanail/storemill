import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutPalette } from '../src/storefront/checkout-ui.ts'
import { logoFromClone } from '../src/pages/source-logo.ts'
import { brandFromClone } from '../src/control/assets.ts'

test('checkout retains brand accents with readable labels and links, rejecting unsafe CSS', () => {
  assert.deepEqual(checkoutPalette({primary:'#318330',buttonText:'#fff'}), {primary:'#318330',text:'#ffffff',link:'#318330'})
  const light=checkoutPalette({primary:'#ffeecc',buttonText:'#fff'})
  assert.equal(light.primary,'#ffeecc');assert.equal(light.text,'#111111');assert.notEqual(light.link,light.primary)
  assert.equal(checkoutPalette({primary:'red;}body{display:none}'}).primary,'#1773b0')
})

test('imported branding uses the main header logo rather than product, payment or secondary marks', () => {
  const html='<img src="/product.webp"><header><img class="payment-logo" src="/visa.svg"><a class="brandmark"><img class="logo-secondary" src="/white-logo.svg"><img class="logo-main" src="/_uploads/store_a/logo.webp?x=1&amp;y=2"></a></header><footer><img class="logo" src="/footer.svg"></footer>'
  assert.equal(logoFromClone(html),'/_uploads/store_a/logo.webp?x=1&y=2')
  assert.equal(brandFromClone(html).logoSvg,'/_uploads/store_a/logo.webp?x=1&y=2')
  assert.equal(logoFromClone('<header><img class="logo" src="javascript:alert(1)"></header>'),'')
  assert.equal(logoFromClone('<header><img src="/product.webp"></header>'),'')
  assert.equal(brandFromClone('<meta name="amboras:source-theme" content="{&quot;primary&quot;:&quot;#318330&quot;}">'+html).logoSvg,'/_uploads/store_a/logo.webp?x=1&y=2')
})
