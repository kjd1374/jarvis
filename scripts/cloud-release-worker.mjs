// Trusted orchestrator only: no application checkout, build or provider credentials.
export async function runReleaseWorker({ origin, ticket, transport = fetch, delay = ms => new Promise(r=>setTimeout(r,ms)), log = console.log, timeout = 24*60*1000 } = {}) {
  const u=new URL(origin);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw Error('invalid_worker_origin');
  if(typeof ticket!=='string'||!ticket||ticket.length>12000||!/^[a-zA-Z0-9_-]+$/.test(ticket))throw Error('invalid_release_grant');
  const deadline=Date.now()+timeout;
  let failures=0;
  while(Date.now()<deadline){
    let r;
    try { r=await transport(new URL('/api/projects/release/step',u),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket}),signal:AbortSignal.timeout(110000)});
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
  const ticket=process.env.JARVIS_RELEASE_TICKET;delete process.env.JARVIS_RELEASE_TICKET;
  if(ticket)console.log(`::add-mask::${ticket}`);
  runReleaseWorker({origin:process.env.JARVIS_APP_ORIGIN,ticket}).catch(()=>{console.error('Cloud release stopped. Review its status in Jarvis.');process.exitCode=1;});
}
