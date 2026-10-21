(() => {
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state={user:null,server:false,settings:false,methods:[],editing:null,fields:[],saving:false,loading:false};
  let epoch=0,serial=0,focusTarget=null,objectURL=null,initialized=false;
  const allowed=()=>state.server&&state.user?.is_admin===true;
  const active=()=>allowed()&&state.settings&&$('#admin-page')&&!$('#admin-page').hidden;
  const errorText=error=>Object.values(error.errors||{}).flat().join(' ')||error.message||'The payment method could not be saved.';
  const imageURL=value=>/^\/api\/manual-payment-methods\/[0-9]+\/image\?v=[0-9]+$/.test(value||'')?value:'';
  function message(selector,text){const el=$(selector);if(el){el.textContent=text;el.hidden=!text;}}
  function render(){
    $('#manual-method-new').disabled=!active()||state.loading||state.saving;
    $('#manual-method-refresh').disabled=!active()||state.loading||state.saving;
    $('#manual-method-count').textContent=state.methods.length+' methods';
    $('#manual-method-list').innerHTML=!allowed()?'<p class="manual-method-empty">Sign in as an administrator in the Laravel app to configure payment methods.</p>':state.loading?'<p class="manual-method-empty" role="status">Loading payment methods…</p>':state.methods.length?state.methods.map(method=>`<article class="manual-method-card"><div class="manual-method-card-heading">${imageURL(method.image_url)?`<img src="${esc(method.image_url)}" alt="${esc(method.name)}">`:''}<div><h3>${esc(method.name)}</h3><span class="admin-status ${method.enabled?'open':'finished'}">${method.enabled?'Enabled':'Disabled'}</span></div></div><div class="manual-method-badges">${method.deposit_enabled?'<span>Deposits ↙</span>':''}${method.withdrawal_enabled?'<span>Withdrawals ↗</span>':''}</div><p class="manual-method-instructions">${esc(method.instructions)}</p><div class="manual-method-card-footer"><span>${(method.fields||[]).length} withdrawal fields</span><button type="button" class="button outline" data-manual-edit="${Number(method.id)}" ${state.saving?'disabled':''}>Edit method ↗</button></div></article>`).join(''):'<div class="manual-method-empty"><h3>Make room for another way.</h3><p>Add an image, payment details and the fields users should complete for withdrawals.</p></div>';
  }
  async function load(){
    if(!active())return;
    const token=++serial,identity=epoch;state.loading=true;message('#manual-method-message','');render();
    try{const response=await window.EdgeAPI.request('/api/admin/manual-payment-methods');if(token!==serial||identity!==epoch||!active())return;if(!Array.isArray(response.methods))throw new Error('Payment methods could not be loaded.');state.methods=response.methods;}
    catch(error){if(token===serial&&identity===epoch&&active())message('#manual-method-message',errorText(error));}
    finally{if(token===serial&&identity===epoch){state.loading=false;render();}}
  }
  function revokePreview(){if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}}
  function close(force=false){
    if(state.saving&&!force)return;
    $('#manual-method-dialog').hidden=true;$('#manual-method-form').reset();$('#manual-method-preview').hidden=true;$('#manual-method-preview').removeAttribute('src');revokePreview();$('#manual-fields-list').replaceChildren();state.editing=null;state.fields=[];document.body.classList.remove('manual-method-open');message('#manual-method-save-error','');
    if(!force&&focusTarget?.isConnected)focusTarget.focus();focusTarget=null;
  }
  function collectFields(){
    return $$('.manual-field-row').map(row=>({key:row.dataset.key,label:$('[data-field-label]',row).value.trim(),type:$('[data-field-type]',row).value,required:$('[data-field-required]',row).checked,hint:$('[data-field-hint]',row).value.trim(),options:$('[data-field-type]',row).value==='select'?$('[data-field-options]',row).value.split('\n').map(value=>value.trim()).filter(Boolean):[]}));
  }
  function renderFields(){
    $('#manual-fields-list').innerHTML=state.fields.map((field,index)=>`<article class="manual-field-row" data-key="${esc(field.key)}"><div class="manual-field-top"><strong>Field ${index+1}</strong><button type="button" class="manual-remove-field" data-field-remove="${index}" aria-label="Remove field ${index+1}">Remove ×</button></div><div class="admin-form-grid"><label class="admin-field"><span>Field label</span><input data-field-label value="${esc(field.label)}" required maxlength="80" placeholder="Account number, wallet address…"></label><label class="admin-field"><span>Input type</span><select data-field-type>${[['text','Short text'],['textarea','Long text'],['email','Email address'],['select','Dropdown']].map(([value,label])=>`<option value="${value}" ${field.type===value?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="admin-field"><span>Help text <small>(optional)</small></span><input data-field-hint value="${esc(field.hint)}" maxlength="160" placeholder="Explain what the user should enter"></label><label class="admin-field" ${field.type==='select'?'':'hidden'}><span>Dropdown choices <small>(one per line, 2–20 choices)</small></span><textarea data-field-options rows="3" ${field.type==='select'?'required':'disabled'}>${esc((field.options||[]).join('\n'))}</textarea></label><label class="manual-required"><input type="checkbox" data-field-required ${field.required?'checked':''}> Required for withdrawal</label></article>`).join('')||'<p class="manual-method-empty">No withdrawal fields yet. Add at least one to enable withdrawals.</p>';
    $('#manual-field-add').disabled=state.fields.length>=12||state.saving;
  }
  function open(method,trigger){
    if(!active()||state.saving)return;
    close(true);state.editing=method?JSON.parse(JSON.stringify(method)):null;state.fields=method?JSON.parse(JSON.stringify(method.fields||[])):[];focusTarget=trigger;
    const form=$('#manual-method-form');
    for(const key of ['name','instructions'])form.elements[key].value=method?.[key]||'';
    for(const key of ['enabled','deposit_enabled','withdrawal_enabled'])form.elements[key].checked=method?method[key]===true:key!=='withdrawal_enabled';
    form.elements.image.required=!method;
    if(method&&imageURL(method.image_url)){$('#manual-method-preview').src=method.image_url;$('#manual-method-preview').hidden=false;}
    $('#manual-method-dialog-title').innerHTML=(method?'Edit this method':'Create a method')+'<span>.</span>';renderFields();
    $('#manual-method-dialog').hidden=false;document.body.classList.add('manual-method-open');form.elements.name.focus();
  }
  async function save(form){
    if(!active()||state.saving||!form.reportValidity())return;
    const definition={name:form.elements.name.value.trim(),instructions:form.elements.instructions.value.trim(),enabled:form.elements.enabled.checked,deposit_enabled:form.elements.deposit_enabled.checked,withdrawal_enabled:form.elements.withdrawal_enabled.checked,fields:collectFields()};
    if(!definition.deposit_enabled&&!definition.withdrawal_enabled){message('#manual-method-save-error','Choose deposits, withdrawals, or both.');return;}
    if(definition.withdrawal_enabled&&!definition.fields.length){message('#manual-method-save-error','Add at least one field for withdrawal details.');return;}
    for(const field of definition.fields){if(field.type==='select'&&(field.options.length<2||field.options.length>20||new Set(field.options).size!==field.options.length)){message('#manual-method-save-error','Each dropdown needs 2–20 unique choices.');return;}}
    const file=form.elements.image.files[0];
    if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1048576)){message('#manual-method-save-error','Choose a JPG, PNG or WebP image up to 1 MB.');return;}
    if(state.editing)definition.version=state.editing.version;
    const data=new FormData();data.set('definition',JSON.stringify(definition));data.set('current_password',form.elements.current_password.value);if(file)data.set('image',file);
    const path='/api/admin/manual-payment-methods'+(state.editing?'/'+state.editing.id:''),identity=epoch;
    state.saving=true;$$('input,textarea,select,button',form).forEach(control=>control.disabled=true);$$('[data-manual-close]').forEach(button=>button.disabled=true);form.setAttribute('aria-busy','true');$('#manual-method-save').textContent='Saving…';message('#manual-method-save-error','');render();
    try{await window.EdgeAPI.request(path,{method:'POST',body:data});if(identity!==epoch||!active())return;state.saving=false;close(true);await load();message('#manual-method-message','Payment method saved. Changes apply to new requests.');$('#manual-method-new').focus();}
    catch(error){if(identity===epoch&&active())message('#manual-method-save-error',errorText(error));}
    finally{data.delete('current_password');form.elements.current_password.value='';if(identity===epoch){state.saving=false;$$('input,textarea,select,button',form).forEach(control=>control.disabled=false);$$('[data-manual-close]').forEach(button=>button.disabled=false);$$('[data-field-options]').forEach(input=>input.disabled=$('[data-field-type]',input.closest('.manual-field-row')).value!=='select');form.setAttribute('aria-busy','false');$('#manual-method-save').textContent='Save payment method ↗';render();}}
  }
  function reset(){epoch++;serial++;state.methods=[];state.loading=false;state.saving=false;close(true);$$('#manual-method-form input,#manual-method-form textarea,#manual-method-form select,#manual-method-form button,[data-manual-close]').forEach(control=>control.disabled=false);$('#manual-method-form').setAttribute('aria-busy','false');$('#manual-method-save').textContent='Save payment method ↗';message('#manual-method-message','');render();}
  function session(detail){const next=detail.user||null,server=detail.serverMode===true;const changed=next?.id!==state.user?.id||Boolean(next?.is_admin)!==Boolean(state.user?.is_admin)||server!==state.server;state.user=next;state.server=server;if(changed){reset();if(active())load();}}
  function init(){
    if(initialized||!$('#manual-methods-template')||!$('#admin-settings-tab'))return;initialized=true;$('#admin-settings-tab').append($('#manual-methods-template').content.cloneNode(true));
    document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;if(button.id==='manual-method-new')open(null,button);if(button.id==='manual-method-refresh'||button.id==='admin-refresh'&&active())load();if(button.dataset.manualEdit)open(state.methods.find(method=>Number(method.id)===Number(button.dataset.manualEdit)),button);if(button.hasAttribute('data-manual-close'))close();if(button.id==='manual-field-add'){state.fields=collectFields();if(state.fields.length<12){state.fields.push({key:'f_'+crypto.randomUUID().replace(/-/g,'').slice(0,16),label:'',type:'text',required:true,hint:'',options:[]});renderFields();$$('[data-field-label]').at(-1)?.focus();}}if(button.hasAttribute('data-field-remove')){state.fields=collectFields();state.fields.splice(Number(button.dataset.fieldRemove),1);renderFields();$('#manual-field-add').focus();}});
    document.addEventListener('change',event=>{if(event.target.hasAttribute('data-field-type')){state.fields=collectFields();renderFields();}if(event.target.name==='image'&&event.target.closest('#manual-method-form')){revokePreview();const file=event.target.files[0];if(file&&['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=1048576&&URL.createObjectURL){objectURL=URL.createObjectURL(file);$('#manual-method-preview').src=objectURL;$('#manual-method-preview').hidden=false;}}});
    document.addEventListener('submit',event=>{if(event.target.id==='manual-method-form'){event.preventDefault();save(event.target);}});
    document.addEventListener('keydown',event=>{if($('#manual-method-dialog').hidden)return;if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=$$('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',$('#manual-method-dialog')).filter(control=>!control.closest('[hidden]'));const first=controls[0],last=controls.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    window.addEventListener('edge:session',event=>session(event.detail||{}));
    window.addEventListener('edge:account-state',event=>session({user:event.detail?.user,serverMode:state.server}));
    window.addEventListener('edge:admin-tab',event=>{state.settings=event.detail?.tab==='settings';if(state.settings)load();else reset();});
    window.addEventListener('edge:navigate',event=>{if(event.detail?.page!=='admin')reset();else if(active())load();});
    session({user:window.EdgeAPI?.user,serverMode:window.EdgeAPI?.serverMode===true});render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
