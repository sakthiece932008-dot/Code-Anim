const $=id=>document.getElementById(id);
$('up').onchange=e=>{const f=e.target.files[0];if(!f)return;const x=f.name.split('.').pop().toLowerCase();
 $('lang').value={js:'js',mjs:'js',jsx:'js',py:'py',java:'java',cpp:'cpp',cc:'cpp',c:'cpp',html:'html'}[x]||'other';
 f.text().then(t=>{$('ta').value=t;edit();msg()})};
$('lang').onchange=()=>msg();
function msg(m){$('msg').textContent=m||($('lang').value==='js'?'':($('lang').value==='py'?'Python runs locally in a real tracer.':'Traced by the server using Claude (needs ANTHROPIC_API_KEY in .env).'))}
const prim=v=>v===null||typeof v!=='object';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=v=>v===null?'∅':typeof v==='string'?'"'+v+'"':typeof v==='object'?JSON.stringify(v).slice(0,16):String(v);
let steps=[],logs=[],cur=0,timer=null,lines=[];
function ser(v,d=0,seen=new Set()){
 if(v==null)return null;const t=typeof v;
 if(t==='function'||t==='symbol')return '(fn)';
 if(t!=='object')return t==='bigint'?Number(v):v;
 if(seen.has(v))return '↺';if(d>7)return '…';seen.add(v);let r;
 if(v instanceof Set)v=[...v];
 if(Array.isArray(v))r=v.slice(0,40).map(x=>ser(x,d+1,seen));
 else{r={};if(v instanceof Map)v=Object.fromEntries(v);const c=v.constructor&&v.constructor.name;if(c&&c!=='Object')r.__cls=c;
  for(const k of Object.keys(v).slice(0,20))r[k]=ser(v[k],d+1,seen)}
 seen.delete(v);return r}
function __t(line,th){
 if(steps.length>=1500)throw new Error('Step limit (1500) reached');
 let v={};try{v=th()}catch(e){}const vars={};
 for(const k in v){if(typeof v[k]!=='function'&&!/^[A-Z]/.test(k)||(v[k]&&typeof v[k]!=='function'))vars[k]=ser(v[k])}
 steps.push({line,vars,out:logs.length})}
const KW=new Set('if for while switch return const let var function class new this true false null undefined of in do else try catch finally typeof delete await async static get set constructor'.split(' '));
function instrument(src){
 const n=new Set(),add=x=>{x=(x||'').split('=')[0].replace('...','').trim();if(/^[A-Za-z_$][\w$]*$/.test(x)&&!KW.has(x))n.add(x)};
 for(const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g))add(m[1]);
 for(const m of src.matchAll(/(?:function\s*[\w$]*|[\w$]+)\s*\(([^()]*)\)\s*(?:=>|\{)/g))m[1].split(',').forEach(add);
 for(const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g))add(m[1]);
 const th='()=>{const o={};'+[...n].map(k=>`try{o.${k}=${k}}catch(e){}`).join('')+'return o}';
 let prev='';
 return src.split('\n').map((ln,i)=>{const t=ln.trim();if(!t||/^(\/\/|\/\*|\*)/.test(t))return ln;
  const ok=!/^(\}|\)|\]|\.|\?|:|else\b|catch\b|finally\b|case\b|default\b|function\b|class\b|async\s+function\b|export\b|import\b|@)/.test(t)&&!/^[\w$]+\s*:/.test(t)&&!/,$/.test(t)
   &&!/^((static|async|get|set)\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|function\b|return\b)[\w$]+\s*\([^)]*\)\s*\{\s*$/.test(t)&&(!prev||/[;{}]$/.test(prev));
  prev=t;return ok?`__t(${i+1},${th});`+ln:ln}).join('\n')}
async function go(){
 stop();
 if(!$('ta').value.trim()){msg('Paste or upload some code first.');return}
 if($('lang').value!=='js')return remoteGo();
 steps=[];logs=[];let err='';
 try{new Function('__t','console',instrument($('ta').value))(__t,{log:(...a)=>logs.push(a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' '))})}catch(e){err=e.message}
 if(!steps.length){msg(err||'Nothing to visualize.');return}
 msg(err?'Stopped: '+err:'');start()}
const PR=(lang,code)=>'You are the engine of a code visualizer for absolute beginners. Simulate running the program below and return ONLY JSON (no markdown): {"steps":[{"line":<1-based source line being executed>,"note":"%s","vars":{"name":value},"print":"<text printed to the console in this step, else empty>","scene":null}]}. Rules: at most 80 steps; condense long loops (first iterations, then the final result). vars holds live variables after the step: numbers, strings, arrays, nested arrays or objects; show trees as objects with value/left/right, linked lists as objects with value/next, maps as objects. For GUI, applet, Android layout, canvas, HTML or React code set scene={"w":300,"h":200,"items":[{"t":"rect|circle|text|line|button","x":0,"y":0,"w":10,"h":10,"r":5,"x2":0,"y2":0,"text":"","color":"#hex"}]} listing everything drawn or rendered so far; otherwise scene is null. Always return at least one step.\nLanguage: '+lang+'\nCode:\n'+code.slice(0,8000);
function setKey(){let k=prompt('Paste your OpenAI or Anthropic API key (kept only in this browser):');if(k){try{localStorage.setItem('ca_key',k.trim())}catch(e){}msg('API key saved.')}}
async function browserAI(lang,code,key){let t;
 if(key.startsWith('sk-ant')){const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true','content-type':'application/json'},body:JSON.stringify({model:'claude-sonnet-5-5',max_tokens:8000,messages:[{role:'user',content:PR(lang,code)}]})});
  const d=await r.json();if(!r.ok)throw new Error((d.error&&d.error.message)||'API error '+r.status);t=d.content.map(x=>x.text||'').join('')}
 else{const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',response_format:{type:'json_object'},messages:[{role:'user',content:PR(lang,code)}]})});
  const d=await r.json();if(!r.ok)throw new Error((d.error&&d.error.message)||'API error '+r.status);t=d.choices[0].message.content}
 const o=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1));let out='';
 return(o.steps||[]).slice(0,150).map(s=>{if(s.print)out+=String(s.print)+'\n';return{line:Math.max(1,+s.line||1),vars:s.vars&&typeof s.vars==='object'&&!Array.isArray(s.vars)?s.vars:{},note:String(s.note||''),scene:s.scene||null,outText:out}})}
async function remoteGo(){
 msg('Tracing your program…');const lang=$('lang').value,code=$('ta').value;let j=null,err='';
 if(location.protocol.startsWith('http')){try{const r=await fetch('/api/trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lang,code})});const d=await r.json();if(r.ok)j=d;else err=d.error}catch(e){err=e.message}}
 if(!j){let key='';try{key=localStorage.getItem('ca_key')||''}catch(e){}
  if(!key){msg(err||'Click 🔑 API key and paste your OpenAI or Anthropic key to visualize this language.');return}
  try{j={steps:await browserAI(lang,code,key),note:'Simulated step by step by Claude; check it against real output.'}}catch(e){msg('Error: '+e.message);return}}
 steps=j.steps||[];logs=[];if(!steps.length){msg('Nothing to visualize.');return}msg(j.note||'');start()}
function lesson(t){t=t.replace(/[;{]\s*$/,'').trim();let m;
 if(!t||t==='}')return 'This line just closes a block. Nothing new happens.';
 if(/^(function|def|public|private|static|void|class|fun)\b.*[({:]?$/.test(t)&&!/=/.test(t)&&/\(|class/.test(t))return 'This defines a recipe (a function). It only runs later, when something calls it by name.';
 if(/^(console\.log|print|System\.out|printf|cout|puts|println|document\.write)/.test(t))return 'Show a message on the screen.';
 if(/^(for|while)\b/.test(t))return 'Start a loop: the computer repeats the lines inside again and again while the condition is true.';
 if(/^else\s*if|^elif|^if\b/.test(t))return 'The computer asks a yes/no question. Only if the answer is yes does it run the lines that belong to this check.';
 if(/^else\b/.test(t))return 'The earlier answer was no, so the computer does this part instead.';
 if(/^return\b/.test(t))return 'Finish this function and hand the answer back to whoever called it.';
 if(m=t.match(/^(?:const|let|var|int|long|float|double|char|bool|boolean|String|auto|val)?\s*([A-Za-z_$][\w$.\[\]]*)\s*=\s*(.+)$/)){
  const decl=/^(const|let|var|int|long|float|double|char|bool|boolean|String|auto|val)\b/.test(t);
  return decl?`Make a labelled box called "${m[1]}" and put ${m[2]} inside it.`:`Take the box called "${m[1]}" and change what is inside it to ${m[2]}.`}
 if(/(\+\+|--|[-+*\/]=)/.test(t))return 'Change the number inside a box (add, subtract or multiply it).';
 if(/\w+\s*\(.*\)$/.test(t))return 'Call (run) a recipe: the computer jumps into that function, does its steps, then comes back.';
 return 'The computer runs this line: '+t}
function changes(s,i){const p=i?steps[i-1].vars:{},o=[];
 for(const k in s.vars){if(JSON.stringify(s.vars[k])!==JSON.stringify(p[k]))o.push(prim(s.vars[k])?`${k} is now ${fmt(s.vars[k])}`:`${k} was updated`)}
 return o.length?' Just happened: '+o.slice(0,3).join(', ')+'.':''}
function explain(s,i){return lesson((lines[s.line-1]||'').trim())+changes(s,i)}
function start(){
 award();
 lines=$('ta').value.split('\n');$('code').innerHTML=lines.map((l,i)=>`<div class="ln" id="l${i+1}"><i>${i+1}</i>${esc(l)||' '}</div>`).join('');
 $('ta').style.display='none';$('code').style.display='block';$('sl').max=steps.length-1;cur=0;draw()}
function edit(){stop();$('ta').style.display='block';$('code').style.display='none'}
function isTree(v){return v&&typeof v==='object'&&!Array.isArray(v)&&('left' in v||'right' in v)}
function isList(v){return v&&typeof v==='object'&&!Array.isArray(v)&&'next' in v}
function nval(n){for(const k of ['value','val','data','key'])if(k in n&&prim(n[k]))return n[k];for(const k in n)if(prim(n[k])&&k!=='left'&&k!=='right'&&k!=='__cls')return n[k];return '•'}
function walk(v){const nodes=[],edges=[];let i=0,md=0;
 (function w(n,d,p){if(!n||typeof n!=='object'||Array.isArray(n))return null;md=Math.max(md,d);const l=w(n.left,d+1,p+'L');const o={x:i++,y:d,p,v:nval(n)};const r=w(n.right,d+1,p+'R');nodes.push(o);if(l)edges.push([o,l]);if(r)edges.push([o,r]);return o})(v,0,'');
 return{nodes,edges,w:i,h:md+1}}
function tree(v,pv){const t=walk(v),pm={};if(isTree(pv))walk(pv).nodes.forEach(o=>pm[o.p]=o.v);
 const X=o=>o.x*44+24,Y=o=>o.y*54+24;
 return `<svg width="${t.w*44+10}" height="${t.h*54+4}">`+t.edges.map(([a,b])=>`<line x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}"/>`).join('')+
 t.nodes.map(o=>`<g class="${!(o.p in pm)?'new':pm[o.p]!==o.v?'chg':''}"><circle cx="${X(o)}" cy="${Y(o)}" r="17"/><text x="${X(o)}" y="${Y(o)}">${esc(fmt(o.v))}</text></g>`).join('')+'</svg>'}
const cl=(x,p,i)=>i>=p.length?'new':JSON.stringify(x)!==JSON.stringify(p[i])?'chg':'';
function cells(a,pa){return a.length?a.map((x,i)=>`<div class="cell ${cl(x,pa,i)}"><i>${i}</i><span>${esc(fmt(x))}</span></div>`).join(''):'<div class="cell"><span>empty</span></div>'}
function arr(a,pa){pa=Array.isArray(pa)?pa:[];
 if(a.length&&a.every(Array.isArray))return a.map((r,i)=>`<div class="row" style="margin-bottom:4px">${cells(r,Array.isArray(pa[i])?pa[i]:[])}</div>`).join('');
 return `<div class="row">${cells(a,pa)}</div>`}
function list(v,pv){const a=[];let n=v,p=pv,k=0;const pa=[];
 while(n&&typeof n==='object'&&k++<30){a.push(nval(n));n=n.next}
 n=pv;k=0;while(n&&typeof n==='object'&&k++<30){pa.push(nval(n));n=n.next}
 return `<div class="row">`+a.map((x,i)=>(i?'<span class="arrow">→</span>':'')+`<div class="cell ${cl(x,pa,i)}"><span>${esc(fmt(x))}</span></div>`).join('')+'</div>'}
function view(vars,pv){let chips='',cards='';const seen=new Set();
 const big=Object.values(vars).filter(isTree).map(x=>JSON.stringify(x));
 for(const[k,v]of Object.entries(vars)){const p=pv[k],j=JSON.stringify(v),st=!(k in pv)?'new':JSON.stringify(p)!==j?'chg':'';
  if(prim(v)){chips+=`<span class="chip ${st}"><b>${esc(k)}</b>${esc(fmt(v))}</span>`;continue}
  const tree_=isTree(v);
  if(tree_&&big.some(b=>b!==j&&b.includes(j))){chips+=`<span class="chip ${st}"><b>${esc(k)}</b>→ node ${esc(fmt(nval(v)))}</span>`;continue}
  if(seen.has(j)){chips+=`<span class="chip"><b>${esc(k)}</b>= same</span>`;continue}seen.add(j);
  let body,ty;
  if(Array.isArray(v)){body=arr(v,p);ty='array['+v.length+']'}
  else if(tree_){body=tree(v,p);ty='tree'}
  else if(isList(v)){body=list(v,p);ty='linked list'}
  else{ty=v.__cls||'object';p=p||{};body='<div class="kv">'+Object.entries(v).filter(e=>e[0]!=='__cls').map(([a,b])=>`<b>${esc(a)}</b><span class="${JSON.stringify(b)!==JSON.stringify(p[a])?'chg':''}">${esc(fmt(b))}</span>`).join('')+'</div>'}
  cards+=`<div class="card ${st==='new'?'new':''}"><h4>${esc(k)}<small>${ty}</small></h4>${body}</div>`}
 return(chips?`<div class="cap">Variables: labelled boxes in the computer's memory</div><div class="chips">${chips}</div>`:'')+cards}
function draw(){const s=steps[cur],p=cur?steps[cur-1].vars:{};
 $('anim').innerHTML=`<div class="note">💡 ${esc(s.note||explain(s,cur))}</div>`+scene(s.scene)+view(s.vars,p);
 document.querySelectorAll('.ln.cur').forEach(e=>e.classList.remove('cur'));
 const el=$('l'+s.line);if(el){el.classList.add('cur');const c=$('code');c.scrollTop=el.offsetTop-c.offsetTop-c.clientHeight/2}
 $('sl').value=cur;$('cnt').textContent=(cur+1)+'/'+steps.length;
 $('out').innerHTML='<small>Output</small>'+esc(s.outText!==undefined?s.outText:logs.slice(0,s.out).join('\n'))}
function step(d){stop();mv(d)}
function mv(d){if(!steps.length)return false;const n=cur+d;if(n<0||n>=steps.length)return false;cur=n;draw();return true}
function stop(){clearInterval(timer);timer=null;$('pl').textContent='▶ Play'}
function play(){if(timer){stop();return}if(!steps.length)return;if(cur>=steps.length-1)cur=0;$('pl').textContent='❚❚ Pause';
 const tick=()=>{if(!mv(1))stop()};timer=setInterval(tick,1300-$('spd').value*120)}
$('spd').oninput=()=>{if(timer){stop();play()}};
$('sl').oninput=e=>{stop();cur=+e.target.value;draw()};
function scene(sc){if(!sc||!Array.isArray(sc.items))return'';const W=Math.min(+sc.w||300,600),H=Math.min(+sc.h||200,500),n=v=>+v||0,c=x=>esc(x||'#3366cc');
 const g=sc.items.slice(0,80).map(it=>{const t=it.t,x=n(it.x),y=n(it.y);
  if(t==='circle')return `<circle cx="${x}" cy="${y}" r="${n(it.r)||10}" style="fill:${c(it.color)};stroke:none"/>`;
  if(t==='line')return `<line x1="${x}" y1="${y}" x2="${n(it.x2)}" y2="${n(it.y2)}" style="stroke:${c(it.color)}"/>`;
  if(t==='text')return `<text x="${x}" y="${y}" style="fill:${c(it.color||'#222')};text-anchor:start">${esc(it.text||'')}</text>`;
  const w=n(it.w)||80,h=n(it.h)||30,b=t==='button';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${b?5:0}" style="fill:${b?'#e5e7eb':c(it.color)};stroke:${b?'#888':'none'}"/>`+(it.text?`<text x="${x+w/2}" y="${y+h/2}" style="fill:#111">${esc(it.text)}</text>`:'')}).join('');
 return `<div class="card"><h4>Screen<small>${W}×${H}</small></h4><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;border:1px solid var(--bd);max-width:100%">${g}</svg></div>`}

function startApp(){$('hero').style.display='none';$('app').style.display='block';window.scrollTo(0,0)}
function home(){stop();$('app').style.display='none';$('hero').style.display='block'}
function stats(){try{return JSON.parse(localStorage.getItem('ca_st'))||{xp:0,streak:0,last:''}}catch(e){return{xp:0,streak:0,last:''}}}
function showStats(s){$('streak').textContent=s.streak||0;$('xp').textContent=s.xp||0}
function award(){const s=stats(),t=new Date().toDateString();if(s.last!==t){s.streak=s.last===new Date(Date.now()-864e5).toDateString()?(s.streak||0)+1:1;s.last=t}s.xp=(s.xp||0)+10;try{localStorage.setItem('ca_st',JSON.stringify(s))}catch(e){}showStats(s)}
showStats(stats());
