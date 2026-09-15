/* Shared by the read-only importer, theme picker, and imported-page renderer. */
function readSourceTheme(doc) {
  const style = el => doc.defaultView.getComputedStyle(el);
  const hex = value => {
    const rgb = String(value).match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < .95)) return null;
    return '#' + rgb.slice(1,4).map(n => Math.round(Number(n)).toString(16).padStart(2,'0')).join('');
  };
  const visible = el => { const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&!el.closest('[data-copy-commerce],[data-store-theme-ui]'); };
  const family = value => value.split(',')[0].trim().replace(/^["']|["']$/g,'');
  const all = [...doc.body.querySelectorAll('*')].filter(el=>!el.matches('script,style,svg,svg *,noscript')&&visible(el));
  const heading = all.find(el=>el.matches('main h1,[role="main"] h1')) || all.find(el=>el.matches('h1')) || all.filter(el=>el.textContent.trim().length>8&&el.textContent.trim().length<200&&el.children.length<3).sort((a,b)=>parseFloat(style(b).fontSize)-parseFloat(style(a).fontSize))[0] || doc.body;
  // Imported builders often use divs/spans for their main copy. Use the
  // predominant readable text face instead of a stray footer paragraph.
  const textFaces=new Map();
  for(const el of all){
    const text=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim(),s=style(el);
    if(text.length<20||parseFloat(s.fontSize)<12||parseFloat(s.fontSize)>24||el.closest('h1,h2,h3,h4,h5,h6,button,header,footer,nav,[role="button"],[role="banner"],[class*="announcement"]'))continue;
    const key=family(s.fontFamily)+'|'+s.fontWeight,entry=textFaces.get(key)||{score:0,el};entry.score+=Math.min(180,text.length);
    if(el.closest('main,[role="main"]')&&!entry.el.closest('main,[role="main"]'))entry.el=el;
    textFaces.set(key,entry);
  }
  const body = [...textFaces.values()].sort((a,b)=>b.score-a.score)[0]?.el || all.find(el=>el.matches('p')&&el.textContent.trim().length>40) || doc.body;
  const actions = all.filter(el=>el.matches('button,a,[role="button"],input[type="submit"]'));
  const cta = actions.find(el=>/^(add to (?:cart|bag)|buy now|buy it now|order now|checkout|shop now|get yours)/i.test(el.textContent.trim())&&hex(style(el).backgroundColor)) || actions.find(el=>hex(style(el).backgroundColor)&&!['#ffffff','#000000'].includes(hex(style(el).backgroundColor))) || actions[0];
  const announcement = all.find(el=>el.matches('.announcement-bar,.announce,[class*="announcement"]')&&hex(style(el).backgroundColor)) || all.find(el=>/free.*shipping|shipping.*free/i.test(el.textContent)&&el.textContent.length<150&&hex(style(el).backgroundColor));
  const backgrounds = all.filter(el=>el.matches('section,main,body,[class*="container"],[class*="content"]')).map(el=>hex(style(el).backgroundColor)).filter(Boolean);
  const paper = hex(style(doc.body).backgroundColor)||hex(style(doc.documentElement).backgroundColor)||backgrounds[0]||'#ffffff';
  const primary = cta&&hex(style(cta).backgroundColor)||'#202223';
  const surface=all.filter(el=>el.children.length&&el.textContent.trim().length>100).map(el=>hex(style(el).backgroundColor)).find(value=>value&&value!==paper&&value!==primary&&value!==(announcement&&hex(style(announcement).backgroundColor)));
  const palette = {paper,ink:hex(style(body).color)||'#202223',primary,buttonText:cta&&hex(style(cta).color)||'#ffffff',secondary:announcement&&hex(style(announcement).backgroundColor)||primary,surface:surface||paper,border:all.map(el=>style(el)).filter(s=>parseFloat(s.borderTopWidth)>0).map(s=>hex(s.borderTopColor)).find(c=>c&&c!==primary)||'#d9d9d9'};
  return {...palette,displayFont:family(style(heading).fontFamily),bodyFont:family(style(body).fontFamily),displayWeight:Number(style(heading).fontWeight)||700,bodyWeight:Number(style(body).fontWeight)||400};
}

function applySourceTheme(doc, brand, options={}) {
  const marker='data-store-theme-node';
  doc.querySelector('style[data-store-theme]')?.remove();
  doc.querySelectorAll('['+marker+']').forEach(el=>el.removeAttribute(marker));
  if(!brand.themeCustomized&&!options.force)return;
  // Iframes have their own font resources; the picker's loaded faces are not inherited.
  if(options.fontDocument&&options.fontDocument!==doc){
    for(const link of options.fontDocument.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"]')){
      if([...doc.querySelectorAll('link[rel="stylesheet"]')].some(existing=>existing.href===link.href))continue;
      const copy=link.cloneNode();copy.setAttribute('data-pb-temporary','');doc.head.appendChild(copy);
    }
  }
  const source=Object.keys(brand.sourceTheme||{}).length?brand.sourceTheme:readSourceTheme(doc);
  const changed=key=>brand[key]!==undefined&&String(brand[key]).toLowerCase()!==String(source[key]).toLowerCase();
  const rgb=hex=>/^#[\da-f]{6}$/i.test(hex||'')?'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')':null;
  const family=value=>String(value||'').split(',')[0].trim().replace(/^["']|["']$/g,'').toLowerCase();
  const isHeading=(el,s)=>el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')||el.closest('h1,h2,h3,h4,h5,h6,[role="heading"]')||parseFloat(s.fontSize)>=24&&el.textContent.trim().length<240;
  const rules=[];let index=0;
  for(const el of [doc.body,...doc.body.querySelectorAll('*')]){
    if(el.matches('script,style,svg,svg *,noscript')||el.closest('[data-store-theme-ui]'))continue;
    const s=doc.defaultView.getComputedStyle(el),styles={};
    const button=el.matches('button,a,[role="button"],input[type="submit"]')||el.closest('button,a[role="button"],.btn,.button');
    for(const [property,keys] of [['background-color',['paper','surface','primary','secondary']],['color',button?['buttonText','primary','ink']:['ink','primary']],['border-color',['border','primary','secondary']]]){
      const current=s.getPropertyValue(property);
      const role=keys.find(key=>rgb(source[key])===current);
      if(role&&changed(role)&&rgb(brand[role]))styles[property]=brand[role];
    }
    const role=isHeading(el,s)?'display':'body';
    if(changed(role+'Font')&&(role==='display'||family(s.fontFamily)===family(source.bodyFont))&&/^[\w\s,'"-]{1,160}$/.test(brand[role+'Font']))styles['font-family']=JSON.stringify(brand[role+'Font'].split(',')[0].replace(/["']/g,''))+', sans-serif';
    if(changed(role+'Weight')&&(role==='display'||Number(s.fontWeight)===Number(source.bodyWeight))&&Number(brand[role+'Weight'])>=100&&Number(brand[role+'Weight'])<=900)styles['font-weight']=String(brand[role+'Weight']);
    if(Object.keys(styles).length){el.setAttribute(marker,String(index++));rules.push('['+marker+'="'+el.getAttribute(marker)+'"]{'+Object.entries(styles).map(([k,v])=>k+':'+v+'!important').join(';')+'}');}
  }
  const sheet=doc.createElement('style');sheet.setAttribute('data-store-theme','');if(options.temporary)sheet.setAttribute('data-pb-temporary','');// Important declarations in a layer outrank copied ID selectors. Keep page
  // overrides in the same layer after theme rules so explicit edits still win.
  const local=doc.querySelector('style[data-pb-overrides]')?.textContent||'';
  sheet.textContent='@layer amboras-theme{'+rules.join('\n')+'\n'+local+'}';doc.head.insertBefore(sheet,doc.head.firstChild);
}
