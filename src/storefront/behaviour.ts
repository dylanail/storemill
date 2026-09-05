import { escapeHtml } from '../lib/http.ts'
import type { Popup } from '../domain/types.ts'

const e = escapeHtml

/**
 * What the page sends back about itself, and the one popup.
 *
 * The tracking script is first-party and tiny: it batches scroll depth,
 * which sections were seen, which buttons were pressed, popup and quiz
 * events, and posts them to the store's own `/_t` with a beacon when the
 * page is hidden or left. No cookie, no third party, and it never runs in
 * the draft preview because the route drops preview traffic.
 */
export function trackingScript(base: string): string {
  return `<script>(function(){var B=${JSON.stringify(base)},q=[],seen={};
function push(t,m){q.push({t:t,m:m||{}});if(q.length>=24)flush()}
function flush(){if(!q.length)return;var b=JSON.stringify({p:location.pathname,e:q.splice(0,40)});try{if(navigator.sendBeacon){navigator.sendBeacon(B+'/_t',new Blob([b],{type:'application/json'}))}else{fetch(B+'/_t',{method:'POST',body:b,headers:{'content-type':'application/json'},keepalive:true})}}catch(e){}}
window.__track=push;window.__flush=flush;
var marks=[25,50,75,100],hit={};function depth(){var h=document.documentElement,d=Math.round((h.scrollTop+window.innerHeight)/Math.max(1,h.scrollHeight)*100);for(var i=0;i<marks.length;i++){var m=marks[i];if(d>=m&&!hit[m]){hit[m]=1;push('scroll',{depth:m})}}}
addEventListener('scroll',depth,{passive:true});addEventListener('load',depth);
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(en){en.forEach(function(x){if(!x.isIntersecting)return;var el=x.target,id=el.getAttribute('data-block')||el.id||el.className.split(' ')[0];if(seen[id])return;seen[id]=1;var t=(el.className.match(/blk--([\\w-]+)/)||[])[1]||el.getAttribute('data-section')||el.tagName.toLowerCase();push('section.view',{blockId:id,blockType:t});io.unobserve(el)})},{threshold:.4});document.querySelectorAll('[data-block],[data-section]').forEach(function(el){io.observe(el)})}
document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a.btn,button.btn,button[type=submit],.stickybar a,.stickybar button'):null;if(!a)return;push('cta.click',{label:(a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60),href:a.getAttribute('href')||''});flush()},true);
addEventListener('pagehide',flush);document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush()});
})();</script>`
}

export const DEFAULT_POPUP: Popup = { enabled: false, trigger: 'exit', after: 20, kind: 'email', headline: 'Before you go', text: 'Leave your email and the offer is yours.', code: '', buttonLabel: 'Send it', href: '#offer', validDays: 7, image: '', dismissDays: 7 }

/**
 * Where the popup's button goes.
 *
 * The email form was prefixed with the store's base path and this link was
 * not, so on the documented `/s/:slug` setup — and on any deployment where a
 * store does not own the whole origin — the two kinds of popup that exist
 * only to send the visitor somewhere both landed on a 404.
 */
function popupHref(base: string, href: string | undefined, kind: string): string {
  const target = href || (kind === 'quiz' ? '/pages/quiz' : '#offer')
  if (target.startsWith('#') || /^[a-z]+:/i.test(target) || target.startsWith('//')) return target
  return target.startsWith('/') ? `${base}${target}` : target
}

/** The popup markup and its runtime. Nothing renders when it is off. */
export function popupHtml(base: string, popup: Popup | undefined): string {
  if (!popup?.enabled) return ''
  const kind = popup.kind ?? 'email'
  const valid = popup.validDays ? `<p class="micro">Valid for ${Number(popup.validDays)} day${Number(popup.validDays) === 1 ? '' : 's'}${kind === 'email' ? ' after sign-up' : ''}.</p>` : ''
  const body =
    kind === 'email'
      ? `<form method="post" action="${e(base)}/subscribe" class="signup" data-popup-form><input name="email" type="email" required placeholder="you@example.com" aria-label="Email"><input type="hidden" name="source" value="popup"><button class="btn" type="submit">${e(popup.buttonLabel || 'Send it')}</button></form>
<p class="micro" data-popup-done hidden>${popup.code ? `You are in. Your code: <strong>${e(popup.code)}</strong>` : 'You are in.'}</p>${valid}`
      : `${popup.code ? `<p class="popup-code">Use code <strong>${e(popup.code)}</strong></p>` : ''}<p><a class="btn" href="${e(popupHref(base, popup.href, kind))}" data-popup-go>${e(popup.buttonLabel || (kind === 'quiz' ? 'Take the quiz' : 'Claim it'))}</a></p>${valid}`
  return `<div class="popup" id="popup" hidden role="dialog" aria-modal="true" aria-labelledby="popup-h" data-trigger="${e(popup.trigger)}" data-after="${Number(popup.after) || 0}" data-days="${Number(popup.dismissDays) || 7}" data-kind="${e(kind)}">
<div class="popup-card">${popup.image ? `<img class="popup-img" src="${e(popup.image)}" alt="" loading="lazy">` : ''}<button type="button" class="popup-x" aria-label="Close">×</button>
<h2 id="popup-h">${e(popup.headline)}</h2>${popup.text ? `<p>${e(popup.text)}</p>` : ''}
${body}</div>
<script>(function(){var p=document.getElementById('popup');if(!p)return;var K='amboras_popup_until',now=Date.now();try{if(Number(localStorage.getItem(K)||0)>now)return}catch(e){}
var shown=false,after=Number(p.dataset.after||0),days=Number(p.dataset.days||7),last=null;
function show(){if(shown)return;shown=true;last=document.activeElement;p.hidden=false;var i=p.querySelector('input[type=email]');i&&i.focus();window.__track&&window.__track('popup.show',{trigger:p.dataset.trigger})}
function close(){p.hidden=true;try{localStorage.setItem(K,String(now+days*86400000))}catch(e){}last&&last.focus&&last.focus()}
p.querySelector('.popup-x').addEventListener('click',close);p.addEventListener('click',function(ev){if(ev.target===p)close()});document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&!p.hidden)close()});
var t=p.dataset.trigger;if(t==='delay'){setTimeout(show,after*1000)}else if(t==='scroll'){addEventListener('scroll',function(){var h=document.documentElement;if((h.scrollTop+innerHeight)/Math.max(1,h.scrollHeight)*100>=after)show()},{passive:true})}else{document.addEventListener('mouseleave',function(ev){if(ev.clientY<=0)show()});if(matchMedia('(hover: none)').matches)setTimeout(show,Math.max(8,after)*1000)}
var g=p.querySelector('[data-popup-go]');g&&g.addEventListener('click',function(){window.__track&&window.__track('popup.submit',{kind:p.dataset.kind});try{localStorage.setItem(K,String(now+365*86400000))}catch(e){}});
var f=p.querySelector('[data-popup-form]');f&&f.addEventListener('submit',function(ev){ev.preventDefault();var d=new FormData(f);fetch(f.action,{method:'POST',body:new URLSearchParams(d),keepalive:true}).catch(function(){});f.hidden=true;p.querySelector('[data-popup-done]').hidden=false;window.__track&&window.__track('popup.submit',{});try{localStorage.setItem(K,String(now+365*86400000))}catch(e){}});
})();</script>`
}

/** The generated storefront keeps its navigation available on small screens. */
export function navigationScript(): string {
  return `<script>(function(){document.querySelectorAll('[data-nav-toggle]').forEach(function(toggle){var nav=document.getElementById(toggle.getAttribute('aria-controls'));if(!nav)return;function show(open){toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close menu':'Open menu');nav.dataset.open=String(open)}toggle.addEventListener('click',function(){show(toggle.getAttribute('aria-expanded')!=='true')});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){show(false);toggle.focus()}});nav.addEventListener('click',function(e){if(e.target.closest('a'))show(false)});});})();</script>`
}
