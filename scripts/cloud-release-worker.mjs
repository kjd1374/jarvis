import { readFileSync } from "node:fs";
// Trusted orchestrator only: no application checkout, build or provider credentials.
export function dispatchTicket(env=process.env) {
  const value=env.JARVIS_RELEASE_TICKET??JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')).inputs?.ticket;
  if(typeof value!=='string'||value.length>12000||!/^[a-zA-Z0-9_-]+$/.test(value))throw Error('invalid_release_grant');
  return value;
}
async function githubIdentity(origin){
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('release_identity_required');
 url.searchParams.set('audience',origin);
 const r=await fetch(url,{redirect:'error',headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('release_identity_required');const body=await r.json();
 if(typeof body.value!=='string'||body.value.length>16000)throw Error('release_identity_required');return body.value;
}
export async function runReleaseWorker({ origin, ticket, getIdentityToken=githubIdentity, transport = fetch, delay = ms => new Promise(r=>setTimeout(r,ms)), log = console.log, timeout = 24*60*1000 } = {}) {
  const u=new URL(origin);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw Error('invalid_worker_origin');
  if(typeof ticket!=='string'||!ticket||ticket.length>12000||!/^[a-zA-Z0-9_-]+$/.test(ticket))throw Error('invalid_release_grant');
  const deadline=Date.now()+timeout;
  let failures=0,identity,identityUntil=0;
  while(Date.now()<deadline){
    let r;
    try { if(!identity||identityUntil<Date.now()){identity=await getIdentityToken(u.origin);identityUntil=Date.now()+180000;} r=await transport(new URL('/api/projects/release/step',u),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${identity}`},body:JSON.stringify({ticket}),signal:AbortSignal.timeout(110000)});
      if(r.status>=500||r.status===429)throw Error('release_step_unavailable');
      failures=0;
    } catch { if(++failures>5)throw Error('release_worker_unreachable');await delay(5000);continue; }
    if(!r.ok)throw Error('release_worker_denied');
    const result=await r.json();
    if(!['queued','running','deployed','failed','cancelled','interrupted'].includes(result.status))throw Error('invalid_release_response');
    log(`Release ${result.status} (${['database','database_wait','environment','deployment','deployment_wait','health','done'].includes(result.phase)?result.phase:'unknown'})`);
    if(result.status==='deployed')return;
    if(['failed','cancelled','interrupted'].includes(result.status))throw Error('release_stopped');
    await delay(Math.min(15000,Math.max(1000,Number(result.retryAfter)||5000)));
  }
  throw Error('release_worker_timeout');
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  let ticket;
  try{ticket=dispatchTicket();}catch{console.error('Missing approved workflow dispatch grant.');process.exit(1);}
  delete process.env.JARVIS_RELEASE_TICKET;
  console.log(`::add-mask::${ticket}`);
  runReleaseWorker({origin:process.env.JARVIS_APP_ORIGIN,ticket}).catch(()=>{console.error('Cloud release stopped. Review its status in Jarvis.');process.exitCode=1;});
}
