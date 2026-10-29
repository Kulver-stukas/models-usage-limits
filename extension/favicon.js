/* A page-local favicon overlay. Never reads or writes the document title. */
(() => {
  const version=LimitsCore.VERSION;
  if(globalThis.UsageFavicon?.version===version)return;
  function create(){
    let enabled=false,disposed=false,generation=0,marked=null,own=null,queued=false;
    const originals=new Map();
    const icon=n=>n instanceof HTMLLinkElement&&/\bicon\b/i.test(n.rel)&&!/apple-touch/i.test(n.rel);
    const attrs=n=>Object.fromEntries(['href','type','sizes'].map(k=>[k,n.getAttribute(k)]));
    const links=()=>[...document.querySelectorAll('link[rel]')].filter(n=>n!==own&&icon(n));
    function restore(){
      observer.disconnect();own?.remove();own=null;
      for(const [node,previous] of originals){
        // Do not undo a provider's newer icon if it changed before observation.
        for(const [name,value] of Object.entries(previous)){
          if(name==='href'&&node.getAttribute('href')!==marked)continue;
          if(name==='type'&&node.getAttribute(name)!=='image/png')continue;
          if(name==='sizes'&&node.getAttribute(name)!=='32x32')continue;
          if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);
        }
      }
      originals.clear();marked=null;
    }
    function watch(){if(enabled&&!disposed)observer.observe(document.head||document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','rel','type','sizes','media']});}
    function paint(){
      if(!enabled||!marked||disposed)return;
      observer.disconnect();
      for(const node of links()){
        if(node.getAttribute('href')!==marked){
          const current=attrs(node),previous=originals.get(node);
          if(previous){if(current.type==='image/png')current.type=previous.type;if(current.sizes==='32x32')current.sizes=previous.sizes;}
          originals.set(node,current);
        }
        node.href=marked;node.type='image/png';node.sizes='32x32';
      }
      if(!own){own=document.createElement('link');own.rel='icon';own.dataset.usageMeterIcon='';own.type='image/png';own.sizes='32x32';}
      own.href=marked;(document.head||document.documentElement).append(own);watch();
    }
    const observer=new MutationObserver(()=>{
      if(queued||!enabled||disposed)return;queued=true;
      queueMicrotask(()=>{queued=false;if(!enabled||disposed)return;
        const changed=links().some(n=>n.getAttribute('href')!==marked);
        if(changed)void build();else paint();
      });
    });
    async function build(){
      const current=++generation;
      const available=links().filter(n=>!n.media||matchMedia(n.media).matches);
      const source=available.at(-1),raw=source&&(source.getAttribute('href')===marked?originals.get(source)?.href:source.getAttribute('href'));
      const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
      const ctx=canvas.getContext('2d');if(!ctx)return;
      if(raw)try{
        const url=new URL(raw,document.baseURI);
        if(!['https:','data:','blob:'].includes(url.protocol))throw Error('icon');
        const img=await new Promise((resolve,reject)=>{
          const image=new Image(),timer=setTimeout(()=>{image.onload=image.onerror=null;reject(Error('timeout'));},2000);
          image.crossOrigin='anonymous';image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);reject(Error('icon'));};image.src=url.href;
        });
        ctx.drawImage(img,0,0,32,32);canvas.toDataURL('image/png');
      }catch{canvas.width=32;}
      // A small, white-bordered green dot remains visible on both page themes.
      ctx.beginPath();ctx.arc(24,24,7,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
      ctx.beginPath();ctx.arc(24,24,5.5,0,Math.PI*2);ctx.fillStyle='#22a66a';ctx.fill();
      if(current!==generation||!enabled||disposed)return;
      const previous=marked;marked=canvas.toDataURL('image/png');
      // Existing marked hrefs still refer to the previous generated image.
      observer.disconnect();
      if(previous)for(const node of links())if(node.getAttribute('href')===previous)node.setAttribute('href',marked);
      paint();
    }
    return {
      set(value){if(disposed||enabled===value)return;enabled=value;++generation;if(enabled){watch();void build();}else restore();},
      destroy(){enabled=false;disposed=true;++generation;restore();},
    };
  }
  globalThis.UsageFavicon={version,create};
})();
