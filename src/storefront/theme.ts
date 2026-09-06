import type { Brand, Theme } from '../domain/types.ts'

/**
 * The generated theme is CSS custom properties plus one stylesheet.
 *
 * Every brand decision the assistant makes — palette, fonts, radius, density —
 * lands in this token block, and the rest of the stylesheet only ever reads
 * tokens. That is what lets "make it darker and roomier" be a two-field edit
 * instead of a rewrite, and it is why the same markup can render as a 1920s
 * leather atelier or a white-cube gallery.
 */
export function themeCss(brand: Brand, theme: Theme): string {
  const primary = brand.primary ?? '#7a4a2b'
  const secondary = brand.secondary ?? '#5d1f28'
  const paper = brand.paper ?? '#f4ece1'
  const ink = brand.ink ?? '#241a14'
  const display = brand.displayFont ?? "'Playfair Display', Georgia, serif"
  const body = brand.bodyFont ?? "'Inter', ui-sans-serif, system-ui, sans-serif"
  const displayWeight=Number(brand.displayWeight)||400,bodyWeight=Number(brand.bodyWeight)||400
  const gallery = theme.template === 'gallery'
  // "Market" was a third option in the template picker and in edit_storefront's
  // enum that rendered byte for byte like the atelier: the merchant chose it,
  // saw no change, and reasonably concluded the picker was broken. It is a
  // shop rather than a showroom now — denser, sans headings, filled buttons.
  const market = theme.template === 'market'
  const gap = theme.density === 'compact' ? '2.5rem' : market ? '3.4rem' : '5rem'

  return `
:root{
  --primary:${primary}; --secondary:${secondary};
  --paper:${paper}; --ink:${ink};
  --muted:color-mix(in srgb, var(--ink) 55%, var(--paper));
  --line:${brand.border??'color-mix(in srgb, var(--ink) 14%, var(--paper))'};
  --raise:${brand.surface??'color-mix(in srgb, var(--paper) 92%, #ffffff)'};
  --radius:${theme.radius}; --section:${gap};
  --display:${display}; --body:${body}; --display-weight:${displayWeight}; --body-weight:${bodyWeight}; --button-label:${brand.buttonText??paper};
  --measure:68ch;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
button,input,select,textarea{max-width:100%}
input,select,textarea{min-width:0}
button,a,input,select,textarea{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
body{margin:0;background:var(--paper);color:var(--ink);font:var(--body-weight) 16px/1.65 var(--body);overflow-x:hidden}
img,svg{max-width:100%;height:auto;display:block}
a{color:inherit}
h1,h2,h3,h4,h5,h6{font-family:var(--display);font-weight:var(--display-weight);line-height:1.06;letter-spacing:-.012em;margin:0}
h1{font-size:clamp(2.4rem,6vw,4.4rem)}
h2{font-size:clamp(1.7rem,3.4vw,2.6rem)}
h3{font-size:1.15rem}
p{margin:0 0 1rem;max-width:var(--measure)}
.wrap{width:min(1180px,92vw);margin-inline:auto}
.eyebrow{font:500 11px/1 var(--body);letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;background:${brand.themeCustomized?'var(--primary)':'var(--ink)'};color:var(--button-label);
  border:1px solid ${brand.themeCustomized?'var(--primary)':'var(--ink)'};border-radius:var(--radius);padding:.95rem 1.6rem;font:500 14px/1 var(--body);
  letter-spacing:.06em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:background .18s,color .18s;max-width:100%;min-height:44px;line-height:1.3;text-align:center}
.btn:hover{background:var(--primary);border-color:var(--primary)}
.btn--ghost{background:transparent;color:var(--ink)}
.btn--ghost:hover{background:var(--ink);color:var(--paper)}
.btn--wide{width:100%;padding:1.15rem}
.announce{background:var(--secondary);color:#fff;font:500 11px/1 var(--body);letter-spacing:.18em;
  text-transform:uppercase;text-align:center;padding:.72rem 1rem}
header.site{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--paper) 88%,transparent);
  backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.site .row{display:flex;align-items:center;gap:2rem;padding:1rem 0}
.brandmark{display:flex;align-items:center;gap:.7rem;text-decoration:none;flex:0 0 auto}
.brandmark img{width:36px;height:36px;border-radius:var(--radius)}
.brandmark .name{font-family:var(--display);font-size:1.25rem;letter-spacing:.06em;text-transform:uppercase}
.brandmark .sub{font:500 9px/1 var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
nav.main{display:flex;gap:1.6rem;margin-left:auto;font:500 12px/1 var(--body);letter-spacing:.14em;text-transform:uppercase}
nav.main a{text-decoration:none;padding-block:.4rem;border-bottom:1px solid transparent}
nav.main a:hover{border-color:var(--ink)}
.tools{display:flex;gap:1rem;align-items:center;font:500 12px/1 var(--body);letter-spacing:.1em;text-transform:uppercase}
[data-nav-toggle]{display:none;border:1px solid var(--line);border-radius:var(--radius);background:var(--raise);color:var(--ink);font:500 13px/1 var(--body);padding:.7rem;min-width:44px;min-height:44px;cursor:pointer}
.cart-layout{display:grid;gap:3rem;grid-template-columns:minmax(0,1.4fr) minmax(0,.8fr);align-items:start}
.cart-layout>*{min-width:0}.cart-layout form input[name=code]{flex:1;width:0}
.pdp>*,.buybox-blk>*,.two-col>*,.iwt>*,.cols>*,.checkout>*,.grid>*{min-width:0}
.hero{position:relative;display:grid;place-items:center;min-height:${gallery ? '58vh' : '72vh'};overflow:hidden;text-align:center}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
/* Generated hero art can come back light or dark, and the headline has to stay
   readable over either. A scrim is the only version of this that always works. */
.hero::after{content:'';position:absolute;inset:0;background:${
  gallery
    ? 'linear-gradient(to bottom, rgba(255,255,255,.42), rgba(255,255,255,.72))'
    : 'radial-gradient(46% 42% at 50% 44%, rgba(0,0,0,.58), rgba(0,0,0,.16) 68%, rgba(0,0,0,.30))'
};z-index:1}
.hero .inner{position:relative;z-index:2;padding:5rem 1rem;max-width:44rem}
.hero h1{color:${gallery ? 'var(--ink)' : '#fff'};text-shadow:${gallery ? 'none' : '0 2px 30px rgba(0,0,0,.35)'}}
.hero p{color:${gallery ? 'var(--muted)' : 'rgba(255,255,255,.9)'};margin-inline:auto;font-size:1.05rem}
section{padding-block:var(--section)}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:2rem;margin-bottom:2.4rem;flex-wrap:wrap}
.grid{display:grid;gap:1.6rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{display:block;text-decoration:none;background:var(--raise);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.card figure{margin:0;aspect-ratio:1;background:var(--line);overflow:hidden}
.card img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.card:hover img{transform:scale(1.035)}
.card .body{padding:1rem 1.1rem 1.3rem}
.card .title{font-family:var(--display);font-size:1.15rem}
.card .sub{color:var(--muted);font-size:.86rem;margin:.25rem 0 .6rem}
.card .price{font-variant-numeric:tabular-nums}
.pdp{display:grid;gap:3.5rem;grid-template-columns:1.05fr .95fr;align-items:start;padding-block:3rem}
.gallery .main{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--raise);aspect-ratio:1}
.gallery .main img{width:100%;height:100%;object-fit:cover}
.thumbs{display:flex;gap:.6rem;margin-top:.7rem}
.thumbs button{padding:0;border:1px solid var(--line);background:none;border-radius:var(--radius);
  width:78px;aspect-ratio:1;overflow:hidden;cursor:pointer}
.thumbs button[aria-current=true]{border-color:var(--ink)}
.buybox{position:sticky;top:6rem;display:flex;flex-direction:column;gap:1.1rem}
.crumbs{font-size:.8rem;color:var(--muted)}
.crumbs a{text-decoration:none}
.rating{display:flex;align-items:center;gap:.55rem;font-size:.86rem;color:var(--muted)}
.stars{color:var(--primary);letter-spacing:.12em}
.price-lg{font-size:1.5rem;font-variant-numeric:tabular-nums}
.opt{display:flex;flex-direction:column;gap:.55rem}
.opt .label{font:500 11px/1 var(--body);letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.pills{display:flex;flex-wrap:wrap;gap:.5rem}
.pill{border:1px solid var(--line);border-radius:var(--radius);background:var(--raise);
  padding:.6rem 1rem;font:500 13px/1 var(--body);cursor:pointer}
.pill[aria-pressed=true]{border-color:var(--ink);background:var(--ink);color:var(--paper)}
.swatches{display:flex;gap:.6rem}
.swatch{width:32px;height:32px;border-radius:999px;border:2px solid var(--line);cursor:pointer;padding:0}
.swatch[aria-pressed=true]{border-color:var(--ink);outline:2px solid var(--paper);outline-offset:-5px}
.buildopts{display:flex;flex-direction:column;gap:.6rem}
.buildopt{display:flex;gap:.75rem;align-items:center;border:1px solid var(--line);border-radius:var(--radius);
  padding:.9rem 1rem;cursor:pointer;background:var(--raise)}
.buildopt[data-selected=true]{border-color:var(--ink)}
.buildopt strong{font-weight:600}
.buildopt small{color:var(--muted);display:block}
.trust{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;font-size:.8rem;color:var(--muted);
  border-top:1px solid var(--line);padding-top:1rem}
.benefits{list-style:none;margin:0;padding:0;display:grid;gap:.35rem;font-size:.9rem}
.benefits li::before{content:'—';color:var(--primary);margin-right:.5rem}
.guarantee{display:flex;gap:.8rem;align-items:flex-start;border:1px solid var(--line);border-radius:var(--radius);padding:.9rem 1rem;background:var(--raise)}
.guarantee .badge{flex:0 0 auto;width:40px;height:40px;border-radius:999px;display:grid;place-items:center;background:var(--primary);color:#fff;font:600 13px/1 var(--body)}
.conv{padding-block:calc(var(--section) * .6);border-top:1px solid var(--line)}
.benefit-grid{display:grid;gap:1.4rem;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.benefit .n{font:500 11px/1 var(--body);letter-spacing:.2em;color:var(--primary)}
.benefit h3{margin:.5rem 0 .4rem;font-size:1.25rem}
.benefit p{font-size:.92rem;color:var(--muted);margin:0}
.tablewrap{overflow-x:auto}
table.compare{width:100%;border-collapse:collapse;font-size:.92rem}
table.compare th,table.compare td{text-align:left;padding:.85rem .9rem;border-bottom:1px solid var(--line);vertical-align:top}
table.compare thead th{font:500 11px/1 var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
table.compare tbody th{font-weight:500;color:var(--muted);width:9rem}
table.compare .us{background:color-mix(in srgb,var(--primary) 8%,var(--paper));font-weight:500}
table.compare thead th.us{color:var(--primary)}
.two-col{display:grid;gap:3rem;grid-template-columns:1fr 1.2fr;align-items:start}
.specs{margin:.8rem 0 0;display:grid;gap:0}
.specs div{display:grid;grid-template-columns:8rem 1fr;gap:1rem;padding:.6rem 0;border-bottom:1px solid var(--line);font-size:.92rem}
.specs dt{color:var(--muted)}.specs dd{margin:0}
details.faq{border-bottom:1px solid var(--line);padding:.7rem 0}
details.faq summary{cursor:pointer;font-weight:500;list-style:none;display:flex;justify-content:space-between;gap:1rem}
details.faq summary::after{content:'+';color:var(--muted)}
details.faq[open] summary::after{content:'–'}
details.faq p{margin:.6rem 0 0;color:var(--muted);font-size:.92rem}
.promise{display:grid;gap:2rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));border:1px solid var(--line);border-radius:var(--radius);padding:1.6rem;background:var(--raise)}
.promise p{font-size:.92rem;margin:.4rem 0 0}
.stickybar{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.7rem 1rem;background:var(--paper);border-top:1px solid var(--line);transform:translateY(110%);transition:transform .25s ease}
.stickybar.show{transform:none}
.skip{position:absolute;left:-999px;top:.5rem;z-index:100;background:var(--ink);color:var(--paper);padding:.6rem 1rem;border-radius:var(--radius);text-decoration:none}
.skip:focus{left:.5rem}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
main:focus{outline:none}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
.popup{position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(0,0,0,.45);padding:1rem}
.popup[hidden]{display:none}
.popup-card{position:relative;background:var(--paper);color:var(--ink);border-radius:var(--radius);padding:2rem;max-width:26rem;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.3)}
.popup-card h2{margin:0 0 .5rem}.popup-card p{margin:0 0 1rem}
.popup-x{position:absolute;top:.5rem;right:.5rem;width:36px;height:36px;border:0;background:transparent;font-size:1.4rem;cursor:pointer;color:inherit;border-radius:999px}
.popup-x:hover{background:var(--raise)}
.popup .signup{display:flex;gap:.5rem;margin:0}.popup .signup input{flex:1;min-width:0}
.popup-img{width:calc(100% + 4rem);margin:-2rem -2rem 1.2rem;border-radius:var(--radius) var(--radius) 0 0;aspect-ratio:2/1;object-fit:cover}
.popup-code{font-family:var(--display);font-size:1.3rem;letter-spacing:.06em;margin:0 0 .8rem}
@media (max-width:640px){.popup{align-items:flex-end}.popup-card{max-width:none}}
.stickybar .t{font-family:var(--display);font-size:1rem}.stickybar .p{font-size:.85rem;color:var(--muted)}
.stickybar .btn{padding:.8rem 1.2rem}
.micro{font-size:.84rem;color:var(--muted)}
.prose{max-width:var(--measure)}
.reviews{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.review{border:1px solid var(--line);border-radius:var(--radius);padding:1.2rem;background:var(--raise)}
.review .who{font-size:.8rem;color:var(--muted);margin-top:.7rem}
.reply{border-left:2px solid var(--primary);margin-top:.8rem;padding-left:.8rem;font-size:.88rem;color:var(--muted)}
.bars{display:grid;gap:.35rem;max-width:22rem}
.bar{display:grid;grid-template-columns:2.4rem 1fr 2.4rem;gap:.6rem;align-items:center;font-size:.8rem;color:var(--muted)}
.bar .track{height:6px;background:var(--line);border-radius:999px;overflow:hidden}
.bar .fill{height:100%;background:var(--primary)}
table.lines{width:100%;border-collapse:collapse}
table.lines td{padding:.85rem 0;border-bottom:1px solid var(--line);vertical-align:middle}
table.lines img{width:64px;height:64px;object-fit:cover;border-radius:var(--radius)}
.totals{margin-left:auto;max-width:22rem;width:100%}
.totals div{display:flex;justify-content:space-between;padding:.35rem 0}
.totals .grand{border-top:1px solid var(--line);margin-top:.5rem;padding-top:.8rem;font-size:1.15rem}
.field{display:flex;flex-direction:column;gap:.35rem;margin-bottom:.9rem}
.field label{font:500 11px/1 var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
input,select,textarea{font:inherit;padding:.8rem .9rem;border:1px solid var(--line);border-radius:var(--radius);
  background:var(--raise);color:inherit;width:100%}
input[type=checkbox],input[type=radio]{width:auto;padding:0;flex:0 0 auto;accent-color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--primary);outline-offset:-1px}
.two{display:grid;gap:.9rem;grid-template-columns:1fr 1fr}
.notice{border:1px solid var(--line);border-left:3px solid var(--primary);padding:.9rem 1.1rem;border-radius:var(--radius);background:var(--raise)}
.gap{display:flex;gap:.6rem;align-items:center;font-size:.86rem;color:var(--muted)}
.gap .track{flex:1;height:5px;background:var(--line);border-radius:999px;overflow:hidden}
.gap .fill{height:100%;background:var(--primary)}
footer.site{background:color-mix(in srgb,var(--ink) 92%,#000);color:color-mix(in srgb,var(--paper) 80%,#fff);margin-top:var(--section)}
footer.site .wrap{display:grid;gap:2.4rem;grid-template-columns:2fr 1fr 1fr;padding-block:3.4rem}
footer.site a{color:inherit;text-decoration:none;opacity:.78;display:block;padding:.22rem 0;font-size:.9rem}
footer.site a:hover{opacity:1}
footer .word{font-family:var(--display);font-size:1.8rem;letter-spacing:.1em;text-transform:uppercase}
.exit-intent{border:1px solid var(--line);border-radius:var(--radius);padding:2rem;max-width:26rem;background:var(--paper);color:var(--ink)}
.exit-intent::backdrop{background:rgba(0,0,0,.5)}
.exit-intent .code{font-family:var(--display);font-size:1.6rem;letter-spacing:.14em}
.upsell{border:1px solid var(--line);border-radius:var(--radius);padding:1rem;display:grid;gap:.8rem;background:var(--raise)}
.upsell .row{display:flex;gap:.8rem;align-items:center}
.upsell img{width:52px;height:52px;object-fit:cover;border-radius:var(--radius)}
.upsell .row form{margin-left:auto}
.price-row{display:flex;gap:.6rem;align-items:baseline}.compare-at{color:var(--muted);font-size:1rem}.off{background:#b3261e;color:#fff;font:600 11px/1 var(--body);padding:.3rem .45rem;border-radius:999px}
.signals{display:grid;gap:.5rem}
.payicons.small{justify-content:flex-start}.payicons.small i{font-size:9px;padding:.3rem .4rem}
.notify{border:1px solid var(--line);border-radius:var(--radius);padding:.9rem 1rem;background:var(--raise);display:grid;gap:.5rem}
.review-media{display:flex;gap:.4rem;margin-top:.6rem}.review-media img{width:64px;height:64px;object-fit:cover;border-radius:var(--radius)}
.timeline{display:grid;gap:0}.step{display:flex;gap:1rem;padding:.7rem 0;position:relative}.step i{flex:0 0 auto;width:14px;height:14px;border-radius:999px;border:2px solid var(--line);background:var(--paper);margin-top:.25rem}.step.done i{background:var(--primary);border-color:var(--primary)}
.step::before{content:'';position:absolute;left:6px;top:1.6rem;bottom:-.6rem;border-left:2px solid var(--line)}.step:last-child::before{display:none}
.bump{display:flex;gap:.8rem;align-items:flex-start;border:2px dashed var(--primary);border-radius:var(--radius);padding:.9rem 1rem;background:color-mix(in srgb,var(--primary) 6%,var(--paper));cursor:pointer}.bump input{margin-top:.2rem}
.checkout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);min-height:100vh}
.co-main{padding:2.2rem clamp(1rem,5vw,4rem) 3rem;max-width:44rem;justify-self:end;width:100%}
.co-side{background:var(--raise);border-left:1px solid var(--line);padding:2.2rem clamp(1rem,4vw,3rem);position:sticky;top:0;height:100vh;overflow:auto}
.co-proof{margin-top:2rem;display:grid;gap:1.2rem}
.co-guarantee{display:flex;gap:.8rem;align-items:flex-start;border:1px solid var(--line);border-radius:var(--radius);padding:.9rem 1rem;background:var(--raise)}.co-guarantee i{font-style:normal;font-size:1.4rem;color:var(--primary)}.co-guarantee b{display:block}.co-guarantee p{margin:.2rem 0 0}
.co-reviews{grid-template-columns:1fr}
.co-logo{display:inline-block;font-family:var(--display);font-size:1.4rem;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;margin-bottom:1.6rem}
.co-block{padding-block:1.2rem}.co-block h2{font-family:var(--body);font-weight:600;font-size:1.05rem;margin-bottom:.8rem}
.co-block .field{margin-bottom:.6rem}
.check{display:flex;gap:.5rem;align-items:center}
.express{margin-bottom:.8rem}.express .or{display:flex;align-items:center;gap:1rem;color:var(--muted);font-size:.8rem;margin-top:1rem}
.express .or::before,.express .or::after{content:'';flex:1;border-top:1px solid var(--line)}
.methods{display:grid;gap:.5rem}
.method{display:flex;gap:.7rem;align-items:center;border:1px solid var(--line);border-radius:var(--radius);padding:.85rem 1rem;cursor:pointer;background:var(--raise)}
.method:has(input:checked){border-color:var(--ink)}.method b{margin-left:auto;font-weight:500}
.pay-el{min-height:120px}
.pay-demo{border:1px solid var(--line);border-radius:var(--radius);padding:1rem;background:var(--raise)}
.pay-demo .row{display:flex;justify-content:space-between;align-items:center}
.cards i{font:600 9px/1 var(--body);letter-spacing:.06em;border:1px solid var(--line);border-radius:3px;padding:.25rem .35rem;margin-left:.3rem;font-style:normal;background:#fff;color:#1a1a1a}
.pay{margin-top:1.2rem;padding:1.15rem;font-size:15px}
.center{text-align:center;margin-top:.9rem}
.co-summary-mobile{display:none;border:1px solid var(--line);border-radius:var(--radius);background:var(--raise);padding:.8rem 1rem;margin-bottom:1rem}
.co-summary-mobile summary{display:flex;justify-content:space-between;cursor:pointer;list-style:none;font-size:.92rem}
.summary-body .lines td{padding:.6rem 0}
.thumb{position:relative;display:inline-block}.thumb img{width:56px;height:56px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--line)}
.thumb b{position:absolute;top:-6px;right:-6px;background:var(--muted);color:#fff;font:600 11px/1 var(--body);width:20px;height:20px;border-radius:999px;display:grid;place-items:center}
.code{display:flex;gap:.5rem;margin:1rem 0}
.upsell-page{max-width:min(760px,92vw);padding-block:3rem}
.upsell-card{display:grid;gap:2rem;grid-template-columns:200px 1fr;align-items:center;border:1px solid var(--line);border-radius:var(--radius);padding:1.6rem;background:var(--raise)}
.upsell-card img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}
@media (max-width:640px){
  .wrap{width:min(1180px,94vw)}
  h1{font-size:clamp(1.9rem,8vw,2.6rem)}
  .site .row{gap:1rem;padding:.75rem 0}.brandmark .name{font-size:1.05rem}.brandmark .sub{display:none}
  .hero{min-height:56vh}.hero .inner{padding:3rem 1rem}
  section{padding-block:calc(var(--section) * .6)}
  .grid{grid-template-columns:repeat(2,1fr);gap:.8rem}.card .body{padding:.7rem .75rem 1rem}.card .title{font-size:1rem}
  .gallery .main{border-radius:0;margin-inline:calc(-50vw + 50%);width:100vw;aspect-ratio:1}.thumbs{overflow-x:auto;padding-bottom:.3rem}.thumbs button{flex:0 0 auto;width:64px}
  .pdp{padding-block:0 2rem;gap:1.4rem}.pills{gap:.4rem}.pill{padding:.55rem .85rem}
  .btn--wide{padding:1.05rem}
  .stickybar .t{font-size:.9rem}.stickybar{padding:.6rem .8rem}
  .reviews{grid-template-columns:1fr}
  table.compare th,table.compare td{padding:.6rem .5rem;font-size:.86rem}table.compare tbody th{width:6rem}
  .specs div{grid-template-columns:6rem 1fr}
  .tier{grid-template-columns:auto 1fr;grid-template-rows:auto auto}.tier-price{grid-column:2;text-align:left;display:flex;gap:.6rem;align-items:baseline}
  .promise{grid-template-columns:1fr;padding:1.2rem}
  .upsell-card{padding:1rem}
  footer.site .wrap{grid-template-columns:1fr}
}
@media (max-width:900px){
  .site .row{flex-wrap:wrap;gap:.75rem}.brandmark{flex:1 1 0;min-width:0}.brandmark .name{overflow-wrap:anywhere}.brandmark img{flex-shrink:0}.tools{margin-left:auto;flex-shrink:0;gap:.5rem}
  [data-nav-toggle]{display:inline-flex;align-items:center;justify-content:center}
  header.site nav.main[data-open="true"]{display:flex;order:5;flex-basis:100%;flex-direction:column;gap:0;margin:0;padding:.4rem 0;border-top:1px solid var(--line)}
  header.site nav.main a{display:flex;align-items:center;min-height:44px;padding:.7rem .3rem}
  .cart-layout{grid-template-columns:minmax(0,1fr);gap:1.5rem}
  .checkout{grid-template-columns:1fr}.co-side{display:none}.co-summary-mobile{display:block}.co-main{justify-self:stretch;max-width:none}
  .upsell-card{grid-template-columns:1fr}
  .pdp{grid-template-columns:1fr;gap:2rem}
  .two-col{grid-template-columns:1fr;gap:2rem}
  .buybox{position:static}
  footer.site .wrap{grid-template-columns:1fr 1fr}
  nav.main{display:none}
}
@media (max-width:640px){
  .co-main .two{grid-template-columns:minmax(0,1fr)}
  input,select,textarea{font-size:16px}
  .site .tools{font-size:11px}.site .tools select{max-width:7rem;font-size:12px}
  .cart-lines,.cart-lines tbody{display:block;width:100%}
  .cart-lines tr{display:grid;grid-template-columns:64px minmax(0,1fr);gap:.6rem 1rem;padding:1rem 0;border-bottom:1px solid var(--line)}
  .cart-lines td{display:block;width:auto!important;border:0;padding:0;min-width:0}
  .cart-lines td:first-child{grid-row:1 / span 2}.cart-lines td:nth-child(3){grid-column:2}.cart-lines td:last-child{grid-column:2;text-align:left!important}
  .cart-lines input[name=quantity]{min-height:44px}.cart-lines button{min-height:44px}
  footer.site .wrap{grid-template-columns:1fr}
  .stickybar>div{min-width:0}.stickybar .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stickybar .btn{flex-shrink:0;padding:.8rem}
  .swatches{flex-wrap:wrap}.swatch{width:44px;height:44px}.pill{min-height:44px}
}

/* Slots a plugin draws into. Four first-party plugins declared components with
   no render function and were drawn by nothing; now that they draw themselves,
   the theme has to have somewhere for them to land. */
.plg-badge{display:flex;gap:.5rem;align-items:baseline;margin:.9rem 0;font-size:.95rem}
.plg-badge span{color:var(--primary);letter-spacing:.08em}
.plg-wall{display:grid;gap:.8rem;margin:1rem 0}
.plg-wall article{border-top:1px solid var(--line);padding-top:.7rem}
.plg-wall h4{margin:.3rem 0 .2rem;font-size:1rem}
.plg-wall p{margin:0;font-size:.92rem}
.plg-stars{color:var(--primary);letter-spacing:.08em;font-size:.85rem}
.plg-who{display:block;margin-top:.35rem;font-size:.8rem;opacity:.7}
.plg-fbt{border:1px solid var(--line);border-radius:var(--radius);padding:.8rem;margin:1rem 0;display:grid;gap:.5rem}
.plg-fbt-head{font:500 .7rem/1 var(--body);letter-spacing:.16em;text-transform:uppercase;opacity:.65}
.plg-fbt-item{display:flex;align-items:center;gap:.6rem;text-decoration:none;color:inherit;font-size:.9rem}
.plg-fbt-item img{width:38px;height:38px;object-fit:cover;border-radius:calc(var(--radius) / 1.5)}
.plg-fbt-item b{margin-left:auto;font-weight:500}
.plg-engrave{display:block;margin:.9rem 0;font-size:.9rem}
.plg-engrave em{opacity:.65;font-style:normal}
.plg-engrave input{width:100%;margin-top:.35rem;padding:.6rem .7rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper);color:inherit;font:inherit}
.plg-contact{display:grid;gap:.8rem;margin-top:1.2rem;max-width:34rem}
.plg-contact label{display:grid;gap:.3rem;font-size:.85rem}
.plg-contact .plg-row{display:grid;gap:.8rem;grid-template-columns:1fr 1fr}
.plg-contact input,.plg-contact textarea{padding:.6rem .7rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper);color:inherit;font:inherit}
.plg-contact button{justify-self:start}
@media (max-width:640px){.plg-contact .plg-row{grid-template-columns:1fr}}
${market ? `
/* Market: a shop, not a showroom. Sans headings at a smaller step, the primary
   colour on the buttons rather than the ink, tighter cards and a shorter hero,
   so more of the catalogue is above the fold. Everything still reads the same
   tokens — this is a different arrangement of the brand, not a second brand. */
h1,h2,h3,h4,h5,h6{font-family:${brand.displayFont?'var(--display)':'var(--body)'};font-weight:${brand.displayWeight?'var(--display-weight)':'600'};letter-spacing:-.02em;line-height:1.12}
h1{font-size:clamp(1.9rem,4.4vw,3rem)}
h2{font-size:clamp(1.35rem,2.6vw,1.95rem)}
h3{font-size:1.05rem}
.eyebrow{letter-spacing:.12em}
.hero{min-height:52vh}
.btn{background:var(--primary);border-color:var(--primary);color:${brand.buttonText?'var(--button-label)':'#fff'};text-transform:none;letter-spacing:.01em;font-weight:600;padding:.85rem 1.4rem}
.btn:hover{background:var(--secondary);border-color:var(--secondary)}
.btn--ghost{background:transparent;color:var(--primary);border-color:var(--primary)}
.btn--ghost:hover{background:var(--primary);color:#fff}
.grid{gap:1.1rem;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.card .title{font-family:var(--body);font-weight:600;font-size:1rem}
.card .body{padding:.8rem .9rem 1rem}
.card .price{font-weight:600}
` : ''}
`
}

/**
 * Google Fonts is the only external request a storefront makes, and it is
 * made so it cannot block paint: preconnect, a preloaded stylesheet swapped in
 * on load, `display=swap` on every face, and only the weights the theme uses.
 * Text renders in the fallback stack instantly and upgrades when the woff2
 * arrives.
 */
export function fontLink(brand: Brand, extra: string[] = []): string {
  const families = new Set<string>()
  for (const stack of [brand.displayFont, brand.bodyFont, ...extra]) {
    const first = /^\s*["']?([a-z0-9][a-z0-9 -]{1,60})["']?(?:\s*,|\s*$)/i.exec(stack ?? '')?.[1]?.trim()
    if (first && !/^(serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif)$/i.test(first)) families.add(first.replace(/ /g, '+'))
  }
  if (!families.size) return ''
  const weights=[...new Set([400,500,600,Number(brand.displayWeight)||400,Number(brand.bodyWeight)||400])].sort((a,b)=>a-b).join(';')
  return (brand.fontFaces?`<style data-brand-fonts>${brand.fontFaces.replace(/<\/style/gi,'')}</style>`:'')+[...families].filter(family=>!['Arial','Georgia','Verdana','Helvetica','Times+New+Roman'].includes(family)).map(family=>{
    const name=family.replace(/\+/g,' ');if((brand.fontFaces||'').includes('font-family:"'+name+'"')||(brand.fontFaces||'').includes("font-family:'"+name+"'"))return ''
    const href=`https://fonts.googleapis.com/css2?family=${family}:wght@${family==='Bebas+Neue'?'400':weights}&display=swap`
    return `<link rel="stylesheet" href="${href}">`
  }).join('')
}
