  function columnChildren(group) {
    return [...group.el.children].filter(el => !el.matches(ignored) && !['absolute','fixed'].includes(computed(el).position) && computed(el).display !== 'none');
  }
  function columnGroup(n) {
    if (!n) return null;
    if (n.el.hasAttribute('data-pb-column') && sourceParent(n)) return sourceParent(n);
    if (['Columns','Row','Grid','Column'].includes(n.type) || nodeMeta(n.id).columns) return n;
    const parent = sourceParent(n);
    return parent && ['Columns','Row','Grid'].includes(parent.type) && structureTypes.includes(n.type) ? parent : null;
  }
  function visualColumnState(group) {
    const saved = nodeMeta(group.id).columns?.[breakpoint], children = columnChildren(group), style = computed(group.el);
    let count = 1;
    if (style.display.includes('grid')) count = style.gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    else if (style.display.includes('flex') && style.flexDirection.startsWith('row')) {
      const first = children[0]?.getBoundingClientRect();count = first ? children.filter(el => Math.abs(el.getBoundingClientRect().top - first.top) < 2).length : 2;
    }
    count = Math.max(1, Math.min(6, Number.isInteger(Number(saved?.count)) ? Number(saved.count) : count));
    const measured = children.slice(0,count).map(el => el.getBoundingClientRect().width);
    return {count, widths: window.__COLUMN_LAYOUT.normalize(saved?.widths || measured, count)};
  }
  function columnPanel(n) {
    const group = columnGroup(n);if (!group) return '';
    const state = visualColumnState(group);
    return (group !== n ? '<p class="column-note">Layout of the containing row</p>' : '') + window.__COLUMN_LAYOUT.panel(state.count, state.widths, names[breakpoint]);
  }
  function canEditVisualColumns(group) {
    const children = columnChildren(group), keys = ['width','min-width','max-width','grid-column','grid-row','box-sizing'];
    if (isLocked(group) || children.some(el => isLocked(get(el.getAttribute(ID)))) || ['display','grid-template-columns'].some(key => group.el.style.getPropertyPriority(key) === 'important') || children.some(el => keys.some(key => el.style.getPropertyPriority(key) === 'important'))) {
      announce('Unlock this row and its columns before changing their layout. Original inline !important styles can be changed in Code.');return false;
    }
    return true;
  }
  function applyVisualColumns(group, count, values, device = breakpoint) {
    if(!canEditVisualColumns(group))return false;
    const children = columnChildren(group);
    const put = (id, bp, styles) => { metadata.overrides[id] ||= {};metadata.overrides[id][bp] ||= {};Object.assign(metadata.overrides[id][bp],styles); };
    const settings = nodeMeta(group.id).columns ||= {};
    const save = (bp, amount, widths) => {
      settings[bp] = {count:amount,widths};
      put(group.id,bp,{display:'grid','grid-template-columns':window.__COLUMN_LAYOUT.tracks(widths)});
      children.forEach(el => { let id=el.getAttribute(ID);if(!id){id=uid();el.setAttribute(ID,id);}put(id,bp,{'width':'auto','min-width':'0px','max-width':'100%','grid-column':'auto','grid-row':'auto','box-sizing':'border-box'}); });
    };
    save(device,count,window.__COLUMN_LAYOUT.normalize(values,count));
    if(device==='desktop'&&!settings.tablet)save('tablet',Math.min(2,count),window.__COLUMN_LAYOUT.normalize([],Math.min(2,count)));
    if(device!=='mobile'&&!settings.mobile)save('mobile',1,[100]);
    syncOverrides();return true;
  }
  function mountVisualColumns(n) {
    const group=columnGroup(n),host=props.querySelector('.column-controls');if(!group||!host)return;
    const state=visualColumnState(group);
    if(group.el.dataset.pbNative==='Columns'&&breakpoint==='desktop')host.querySelector('small').textContent='Changing one width adjusts the others to total 100%. Reducing the column count moves its content into the last remaining column.';
    window.__COLUMN_LAYOUT.bind(host,state.widths,values=>{
      if(!applyVisualColumns(group,values.length,values))return false;
      touch();return true;
    },count=>{
      if(!canEditVisualColumns(group)){renderInspector();return;}
      operation('change column count',()=>{
      // Imported content wraps; newly added column containers can also grow.
      // Reducing a managed group's count preserves its contents in the final column.
      if(breakpoint==='desktop'&&group.el.dataset.pbNative==='Columns'){
        let columns=columnChildren(group);
        while(columns.length<count){const el=doc.createElement('div');el.setAttribute('data-pb-native','Column');el.setAttribute('data-pb-column','');el.setAttribute(ID,uid());group.el.appendChild(el);columns.push(el);}
        if(columns.length>count){const last=columns[count-1];columns.slice(count).forEach(el=>{while(el.firstChild)last.appendChild(el.firstChild);el.remove();});}
      }
      applyVisualColumns(group,count,window.__COLUMN_LAYOUT.normalize([],count));
      });
    },()=>begin('resize columns'),commit);
  }
