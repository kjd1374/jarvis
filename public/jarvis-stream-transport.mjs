// Quick Tunnels do not support SSE. Keep upstream streams on the Mac and deliver
// bounded chunks over authenticated short HTTP polls; no provider credentials.
import { randomUUID } from 'node:crypto';
export function createStreamTransport({ allowed, clock = Date.now }) {
  const jobs = new Map();
  const send = (res, status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end(JSON.stringify(value)); } };
  const dispose = job => { if (!jobs.delete(job.id)) return; clearInterval(job.timer); clearTimeout(job.pollTimer); job.upstream.destroy(); if (job.pending) send(job.pending, 410, { error: 'stream_closed' }); };
  const flush = job => {
    if (!job.pending || !job.chunks.length && !job.done && !job.error) return;
    const res = job.pending; job.pending = null; clearTimeout(job.pollTimer);
    const value = { chunks: job.chunks.splice(0), done: job.done, ...(job.error ? { error: job.error } : {}) };
    job.buffered = 0; job.upstream.resume(); send(res, 200, value);
    if (job.done || job.error) dispose(job);
  };
  return {
    open(upstream, session, res) {
      if (jobs.size >= 4) { upstream.destroy(); send(res, 429, { error: 'stream_busy' }); return; }
      const job = { id: randomUUID(), session, upstream, chunks: [], total: 0, buffered: 0, pending: null, seenAt: clock(), done: false, error: null };
      jobs.set(job.id, job);
      upstream.on('data', bytes => {
        job.total += bytes.length; job.buffered += bytes.length;
        if (job.total > 32_000_000) { job.error = 'stream_too_large'; upstream.destroy(); flush(job); return; }
        job.chunks.push(bytes.toString('base64')); if (job.buffered >= 128_000) upstream.pause(); flush(job);
      });
      upstream.on('end', () => { job.done = true; flush(job); });
      upstream.on('error', () => { job.error = 'stream_interrupted'; flush(job); });
      job.timer = setInterval(async () => { if (clock() - job.seenAt > 30_000 || !await allowed(session)) dispose(job); }, 5000); job.timer.unref();
      send(res, 200, { id: job.id, status: upstream.statusCode, contentType: upstream.headers['content-type'] || 'text/event-stream' });
      return job.id;
    },
    async handle(req, res, session) {
      if (req.url === '/_jarvis/transport.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, no-store' }); res.end(streamClientSource); return true; }
      const match = req.url.match(/^\/_jarvis\/stream\/([a-f0-9-]{36})$/);
      if (!match) return false;
      const job = jobs.get(match[1]);
      if (!job || job.session !== session) { send(res, 404, { error: 'stream_missing' }); return true; }
      if (req.method === 'DELETE') { dispose(job); send(res, 200, { cancelled: true }); return true; }
      if (req.method !== 'GET') { send(res, 405, {}); return true; }
      if (job.pending) { send(res, 409, { error: 'stream_busy' }); return true; }
      job.seenAt = clock(); session.seenAt = clock(); job.pending = res;
      res.once('close', () => { if (job.pending === res) { job.pending = null; clearTimeout(job.pollTimer); } });
      job.pollTimer = setTimeout(() => { if (job.pending !== res) return; job.pending = null; send(res, 200, { chunks: [], done: false }); }, 12_000);
      flush(job); return true;
    },
    close() { for (const job of jobs.values()) dispose(job); },
  };
}
export function injectStreamClient(html) {
  const tag = '<script src="/_jarvis/transport.js"></script>';
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, head => head + tag);
  if (/<!doctype[^>]*>/i.test(html)) return html.replace(/<!doctype[^>]*>/i, head => head + tag);
  return tag + html;
}
export const streamClientSource = String.raw`(()=>{
if(window.__jarvisStreamTransport)return;window.__jarvisStreamTransport=true;
const original=window.fetch.bind(window),active=new Map();
window.addEventListener('pagehide',()=>{for(const cancel of active.values())cancel();});
window.fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url);
 if(url.origin!==location.origin||url.pathname.startsWith('/_jarvis/')||url.pathname.startsWith('/__jarvis'))return original(req);
 const headers=new Headers(req.headers);headers.set('X-Jarvis-Stream','poll-v1');
 const response=await original(new Request(req,{headers}));
 if(response.headers.get('X-Jarvis-Stream')!=='poll-v1')return response;
 const meta=await response.json();if(!meta.id||!/^[a-f0-9-]{36}$/.test(meta.id))throw Error('Invalid private stream');
 const path='/_jarvis/stream/'+meta.id;let finished=false;
 const finish=()=>{finished=true;active.delete(meta.id);req.signal.removeEventListener('abort',cancel);};
 const cancel=()=>{if(finished)return;finish();void original(path,{method:'DELETE',credentials:'same-origin',keepalive:true}).catch(()=>{});};
 active.set(meta.id,cancel);req.signal.addEventListener('abort',cancel,{once:true});
 if(req.signal.aborted){cancel();throw new DOMException('Cancelled','AbortError');}
 const stream=new ReadableStream({async pull(controller){
  try{const r=await original(path,{credentials:'same-origin',signal:req.signal});if(!r.ok)throw Error('Private stream connection closed');const batch=await r.json();
   if(batch.error)throw Error(batch.error);
   for(const chunk of batch.chunks||[]){const bytes=atob(chunk),data=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)data[i]=bytes.charCodeAt(i);controller.enqueue(data);}
   if(batch.done){finish();controller.close();}
  }catch(error){cancel();controller.error(error);}
 },cancel});
 const result=new Response(stream,{status:meta.status,headers:{'Content-Type':meta.contentType,'Cache-Control':'no-store'}});
 Object.defineProperty(result,'url',{value:response.url});return result;
};
const Native=window.EventSource;
class Source extends EventTarget{
 constructor(url,options={}){super();const target=new URL(url,location.href);if(target.origin!==location.origin)return new Native(url,options);
  this.url=target.href;this.withCredentials=!!options.withCredentials;this.readyState=0;this.closed=false;this.lastId='';this.retry=3000;this.connect();
 }
 emit(type,event){this.dispatchEvent(event);if(typeof this['on'+type]==='function')this['on'+type](event);}
 close(){this.closed=true;this.readyState=2;clearTimeout(this.timer);this.controller?.abort();}
 async connect(){if(this.closed)return;this.readyState=0;const controller=new AbortController();this.controller=controller;
  try{const headers={'Accept':'text/event-stream'};if(this.lastId)headers['Last-Event-ID']=this.lastId;
   const response=await fetch(this.url,{headers,credentials:'same-origin',signal:controller.signal});
   if(response.status===204){this.close();return;}if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('Event stream unavailable');
   this.readyState=1;this.emit('open',new Event('open'));const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',data=[],type='message';
   const line=value=>{if(!value){if(data.length){this.emit(type,new MessageEvent(type,{data:data.join('\n'),lastEventId:this.lastId,origin:location.origin}));}data=[];type='message';return;}
    if(value[0]===':')return;const split=value.indexOf(':'),field=split<0?value:value.slice(0,split);let text=split<0?'':value.slice(split+1);if(text[0]===' ')text=text.slice(1);
    if(field==='data')data.push(text);else if(field==='event')type=text||'message';else if(field==='id'&&!text.includes('\0'))this.lastId=text;else if(field==='retry'&&/^\d+$/.test(text))this.retry=Math.max(500,Math.min(30000,Number(text)));
   };
   while(!this.closed){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let match;while((match=/\r\n|\r|\n/.exec(buffer))){if(match[0]==='\r'&&match.index===buffer.length-1)break;line(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}}
  }catch(error){if(this.closed)return;}finally{controller.abort();}
  if(!this.closed){this.readyState=0;this.emit('error',new Event('error'));this.timer=setTimeout(()=>this.connect(),this.retry);}
 }
}
for(const [key,value]of Object.entries({CONNECTING:0,OPEN:1,CLOSED:2})){Object.defineProperty(Source,key,{value});Object.defineProperty(Source.prototype,key,{value});}
window.EventSource=Source;
})();`;
