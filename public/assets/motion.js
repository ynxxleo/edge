(() => {
  'use strict';
  const body=document.body;
  if(!body)return;
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const loader=document.getElementById('edge-page-loader');
  const shell=document.getElementById('app-shell');
  let readyState=false,fallback;
  function ready(){
    if(readyState)return;
    readyState=true;clearTimeout(fallback);
    delete body.dataset.edgeLoading;
    if(loader){loader.hidden=true;loader.setAttribute('aria-hidden','true');}
    shell?.setAttribute('aria-busy','false');
    body.dataset.edgeReady='true';
    reveal();
  }
  const observed=new WeakSet();
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('edge-is-visible');observer.unobserve(entry.target);}});
  },{threshold:.08,rootMargin:'0px 0px -28px 0px'}):null;
  function reveal(root=document){
    root.querySelectorAll('[data-reveal]').forEach(element=>{
      if(observed.has(element))return;observed.add(element);
      if(reduced()||!observer){element.classList.add('edge-is-visible');return;}
      element.classList.add('edge-reveal-ready');observer.observe(element);
    });
  }
  function transition(element){
    if(!element||reduced())return;
    element.classList.remove('edge-page-enter');
    // Restart only on a deliberate page change, never on background refreshes.
    void element.offsetWidth;
    element.classList.add('edge-page-enter');
  }
  function busy(button,label='Please wait…'){
    if(!button)return ()=>{};
    if(button.dataset.edgeBusy==='true')return ()=>{};
    const html=button.innerHTML,disabled=button.disabled,aria=button.getAttribute('aria-busy');
    button.dataset.edgeBusy='true';button.disabled=true;button.setAttribute('aria-busy','true');button.classList.add('edge-is-busy');
    button.replaceChildren();
    const spinner=document.createElement('span');spinner.className='edge-button-spinner';spinner.setAttribute('aria-hidden','true');
    const caption=document.createElement('span');caption.textContent=label;
    button.append(spinner,caption);
    let released=false;
    return ()=>{if(released)return;released=true;delete button.dataset.edgeBusy;button.disabled=disabled;button.innerHTML=html;button.classList.remove('edge-is-busy');if(aria===null)button.removeAttribute('aria-busy');else button.setAttribute('aria-busy',aria);};
  }
  let networkCount=0,networkStatus;
  function network(){
    networkCount++;
    if(!networkStatus){networkStatus=document.createElement('div');networkStatus.className='edge-request-status';networkStatus.setAttribute('role','status');networkStatus.setAttribute('aria-live','polite');networkStatus.innerHTML='<span>Saving changes…</span>';body.append(networkStatus);}
    networkStatus.hidden=false;
    let released=false;
    return ()=>{if(released)return;released=true;networkCount=Math.max(0,networkCount-1);if(!networkCount)networkStatus.hidden=true;};
  }
  window.EdgeMotion={ready,reveal,transition,busy,network};
  if(loader&&body.hasAttribute('data-edge-preload')){
    loader.hidden=false;loader.setAttribute('aria-hidden','false');body.dataset.edgeLoading='true';shell?.setAttribute('aria-busy','true');
    // Network or startup failures must never leave the page trapped behind a loader.
    fallback=setTimeout(ready,12000);
  }
  const loaded=()=>{if(body.dataset.edgePreload!=='app'||body.dataset.runtime==='static')ready();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loaded,{once:true});else loaded();
  window.addEventListener('pageshow',event=>{if(event.persisted)ready();});
})();
