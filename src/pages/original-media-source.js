/** Select a file explicitly supplied by the source, never a rendered frame or guessed CDN URL.
 * Shared by product imports and the page editor, which must make the same choice. */
export function originalMediaSource(attrs, sources = [], kind = 'image') {
  const usable = value => typeof value === 'string' && !!value.trim() && !/^(?:data:|blob:|about:|javascript:)/i.test(value.trim());
  const first = values => values.find(usable)?.trim() || '';
  if (kind === 'video') {
    const files = sources.filter(s => usable(s.src) && (/video\/(mp4|webm)/i.test(s.type || '') || /\.(mp4|webm|mov)([?#]|$)/i.test(s.src)));
    files.sort((a,b) => Number(b.width || b['data-width'] || 0) - Number(a.width || a['data-width'] || 0));
    return first([attrs['data-original'], ...files.map(s => s.src), attrs['data-src'], attrs.src]);
  }
  const explicit = first([attrs['data-original'], attrs['data-zoom-image'], attrs['data-large_image'], attrs['data-full'], attrs['data-full-src'], attrs['data-full-image'], attrs['data-image-large'], attrs['data-original-src']]);
  if (explicit) return explicit;
  // Tokenize like srcset: a comma inside a CDN URL belongs to that URL.
  const candidates = value => {
    let i=0;const result=[];
    while(i<value.length){
      while(i<value.length && /[\t\n\f\r ,]/.test(value[i]))i++;
      const start=i;while(i<value.length && !/[\t\n\f\r ]/.test(value[i]))i++;
      const raw=value.slice(start,i),url=raw.replace(/,+$/,'');let descriptor='';
      if(!raw.endsWith(',')){const begin=i;while(i<value.length && value[i]!==',')i++;descriptor=value.slice(begin,i).trim();i++;}
      const match=/^(\d+(?:\.\d+)?)(w|x)$/.exec(descriptor);
      if(usable(url) && (!descriptor || match))result.push({url,size:match?Number(match[1]):1,unit:match?.[2] || 'x'});
    }return result;
  };
  // Keep art-directed mobile <source media> crops out of the product catalog.
  const sets = [attrs['data-srcset'], attrs['data-lazy-srcset'], attrs.srcset, ...sources.filter(s => !s.media).flatMap(s => [s['data-srcset'],s.srcset])];
  const options=sets.filter(Boolean).flatMap(candidates);
  const widths=options.filter(c=>c.unit==='w'),pool=widths.length?widths:options;
  pool.sort((a,b)=>b.size-a.size);
  return pool[0]?.url || first([attrs['data-src'],attrs['data-lazy-src'],attrs.src]) || (/^data:image\//i.test(attrs.src || '') ? attrs.src : '');
}
