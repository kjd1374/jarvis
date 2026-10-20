// Explicit project setup jobs only. Provider credentials never enter model context or Git.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
const fail = code => Object.assign(new Error(code), { code });
export function setupName(job) {
  return `jarvis-${String(job.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'project'}-${createHash('sha256').update(`${job.space}:${job.projectId}:${job.id}`).digest('hex').slice(0, 12)}`;
}
export function chooseEnvironment(job, available) {
  const databaseNeeded = job.database === 'supabase' || job.database === 'auto' && /저장|데이터베이스|회원|계정|동기화|database|persist|storage|로그인/i.test(job.description ?? '');
  if (job.target === 'vercel' && !available.vercel) throw fail('vercel_connection_required');
  if (job.database === 'supabase' && !available.supabase) throw fail('supabase_connection_required');
  const serverNeeded = /실시간|소켓|영상|렌더|구독|cli|백그라운드|worker|socket|render/i.test(job.description ?? '');
  const target = job.target === 'mac' || job.target === 'auto' && (!available.vercel || serverNeeded || databaseNeeded && !available.supabase) ? 'mac' : 'vercel';
  if (target === 'mac' && job.database === 'supabase') throw fail('supabase_requires_vercel');
  const database = job.database === 'supabase' ? 'supabase' : !databaseNeeded ? 'none' : target === 'vercel' ? 'supabase' : 'sqlite';
  return { target, database, reason: target === 'mac' ? '맥미니의 격리 실행 환경을 사용합니다. 서버 작업과 로컬 데이터 보관을 지원하며 별도 클라우드 계정 없이 개발할 수 있습니다.' : '연결된 Vercel 계정으로 웹 배포를 준비합니다. 서버리스 환경이며 필요한 데이터는 연결된 Supabase에 보관합니다.' };
}
export function starterFiles(plan) {
  const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>새 프로젝트</title><style>body{background:#111;color:#eee;font:18px system-ui;margin:32px}button,input{font:inherit;padding:12px}</style><h1>프로젝트 개발 환경</h1><p>Jarvis 대화에서 만들고 싶은 기능을 요청해주세요.</p></html>\n';
  return {
    '.gitignore': 'node_modules/\n.env*\n!.env.example\n.vercel/\ndata/\n*.sqlite*\n',
    'package.json': JSON.stringify({ name: 'jarvis-project', private: true, type: 'module', scripts: { start: 'node server.mjs', test: 'node --test tests/*.test.mjs' }, engines: { node: '24.x' } }, null, 2) + '\n',
    'public/index.html': html,
    'server.mjs': `import http from 'node:http';\nimport { readFile } from 'node:fs/promises';\nimport { resolve, extname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nexport function createServer(){return http.createServer(async(req,res)=>{try{if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));return;}const root=resolve('public'), pathname=decodeURIComponent(new URL(req.url,'http://local').pathname), path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}const bytes=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}});}\nif(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))createServer().listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1');\n`,
    'tests/app.test.mjs': `import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from '../server.mjs';\ntest('application serves HTML, health and rejects missing paths',async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const url='http://127.0.0.1:'+server.address().port;const page=await fetch(url);assert.equal(page.status,200);assert.match(await page.text(),/<h1>/);assert.deepEqual(await(await fetch(url+'/health')).json(),{ok:true});assert.equal((await fetch(url+'/missing')).status,404);}finally{await new Promise(r=>server.close(r));}});\n`,
    'jarvis.project.json': JSON.stringify({ version: 1, target: plan.target, database: plan.database, dataDirectory: '/persistent', instructions: 'Use process.env.DATA_DIR for persistent application data. Keep credentials outside source. npm test must verify implemented behavior. Browser development and screens are operated from Jarvis.' }, null, 2) + '\n',
    ...(plan.database === 'supabase' ? {
      'storage.mjs': "const table=()=>process.env.SUPABASE_URL+'/rest/v1/jarvis_records';const headers=()=>({apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'});export async function getRecord(key){const r=await fetch(table()+'?key=eq.'+encodeURIComponent(key)+'&select=value',{headers:headers()});if(!r.ok)throw Error('storage_unavailable');return(await r.json())[0]?.value??null;}export async function putRecord(key,value){const r=await fetch(table(),{method:'POST',headers:{...headers(),Prefer:'resolution=merge-duplicates'},body:JSON.stringify({key,value})});if(!r.ok)throw Error('storage_unavailable');}\n",
      'api/records.mjs': "import {getRecord,putRecord} from '../storage.mjs';export default async function handler(req,res){res.setHeader('Cache-Control','no-store');const key=String(req.query?.key||'');if(!/^[a-zA-Z0-9_-]{1,160}$/.test(key))return res.status(400).json({error:'invalid_key'});try{if(req.method==='GET')return res.status(200).json({value:await getRecord(key)});if(req.method!=='POST')return res.status(405).end();const host=req.headers['x-forwarded-host']||req.headers.host;if(req.headers.origin!=='https://'+host)return res.status(403).end();if(JSON.stringify(req.body).length>65536)return res.status(413).end();await putRecord(key,req.body);res.status(200).json({saved:true});}catch{res.status(503).json({error:'storage_unavailable'});}}\n",
    } : {}),
    ...(plan.database === 'sqlite' ? { 'storage.mjs': "import {DatabaseSync} from 'node:sqlite';import {mkdirSync} from 'node:fs';import {join} from 'node:path';const directory=process.env.DATA_DIR||'data';mkdirSync(directory,{recursive:true});export const database=new DatabaseSync(join(directory,'app.sqlite'));\n" } : {}),
  };
}
export async function providerRequest(provider, path, { token, team, method = 'GET', body, transport = fetch, signal, missing = false } = {}) {
  const root = provider === 'vercel' ? 'https://api.vercel.com' : provider === 'supabase' ? 'https://api.supabase.com' : null;
  if (!root || !path.startsWith('/') || path.includes('://') || !token) throw fail('provider_connection_required');
  const url = new URL(root + path); if (provider === 'vercel' && team) url.searchParams.set('teamId', team);
  const response = await transport(url, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(60_000) });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? `${provider}_connection_required` : `${provider}_setup_failed`);
  const raw=await response.text();return raw?JSON.parse(raw):{};
}
export async function executeProvision(client, job, { stateDir, run, env = process.env, platform = process.platform, transport = fetch, delay = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  if (!stateDir || !run || !/^[a-f0-9-]{36}$/.test(job.id) || !['company','personal'].includes(job.space) || typeof job.projectId !== 'string' || !['auto','mac','vercel'].includes(job.target) || !['auto','none','supabase'].includes(job.database)) throw fail('invalid_setup_scope');
  const identity = { space: job.space, projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken };
  const directory = join(stateDir, 'setup-' + createHash('sha256').update(`${job.space}:${job.projectId}:${job.id}`).digest('hex'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journalPath = join(directory, 'journal.json');
  let journal = {};
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw fail('setup_journal_invalid'); }
  const save = async () => { const temp = journalPath + '.tmp'; await writeFile(temp, JSON.stringify(journal), { mode: 0o600 }); await rename(temp, journalPath); };
  const abort = new AbortController(); let phase = '연결된 계정 확인';
  const pulse = async () => { if(abort.signal.aborted)throw fail('stale_job');try{await client.request('/api/automation/provision', {...identity,phase:'heartbeat',progress:phase});}catch(e){abort.abort();throw e;} };
  const timer = setInterval(()=>pulse().catch(()=>{}),30_000);
  const gh = async (path, method='GET', body, missing=false) => {
    await pulse();
    const r = await run('gh',['api','--hostname','github.com','--method',method,path,...(body?['--input','-']:[])], { input:body?JSON.stringify(body):'', timeout:120_000, signal:abort.signal });
    if(r.code!==0){if(missing && /HTTP 404|Not Found/i.test(r.err))return null;throw fail('github_setup_failed');}
    try{return JSON.parse(r.out);}catch{throw fail('github_setup_failed');}
  };
  try {
    await pulse();
    if (journal.result) { await client.request('/api/automation/provision',{...identity,phase:'result',result:journal.result});return; }
    const prefix = job.space === 'company' ? 'JARVIS_COMPANY_' : 'JARVIS_PERSONAL_';
    const vercelToken = job.credentials?.vercel?.token ?? env[prefix+'VERCEL_TOKEN'], supabaseToken = job.credentials?.supabase?.token ?? env[prefix+'SUPABASE_TOKEN'];
    const organization = job.credentials?.supabase?.organization ?? env[prefix+'SUPABASE_ORG'];
    const available = { vercel:!!vercelToken, supabase:!!supabaseToken&&!!organization };
    const team=job.credentials?.vercel?.organization ?? env[prefix+'VERCEL_TEAM'];
    if(job.target!=='mac'&&available.vercel){try{const account=await providerRequest('vercel',team?`/v2/teams/${team}`:'/v2/user',{token:vercelToken,transport,signal:abort.signal});available.vercel=(account.team??account.user??account)?.billing?.plan==='hobby';}catch{available.vercel=false;}}
    if(job.target!=='mac'&&available.supabase){try{const orgs=await providerRequest('supabase','/v1/organizations',{token:supabaseToken,transport,signal:abort.signal});available.supabase=orgs.some(o=>(o.slug??o.id)===organization);if(available.supabase){const org=await providerRequest('supabase',`/v1/organizations/${organization}`,{token:supabaseToken,transport,signal:abort.signal});available.supabase=org.plan==='free';}}catch{available.supabase=false;}}
    if(journal.plan?.target==='vercel'&&!available.vercel)throw fail('vercel_connection_required');
    if(journal.plan?.database==='supabase'&&!available.supabase)throw fail('supabase_connection_required');
    const plan = journal.plan ?? chooseEnvironment(job,available);
    journal.plan=plan; await save();
    if(plan.target==='mac'&&platform!=='darwin'){const docker=await run('docker',['version','--format','{{.Server.Version}}'],{timeout:15000,signal:abort.signal});if(docker.code!==0||!docker.out.trim())throw fail('docker_unavailable');}
    const name=journal.name??setupName(job), marker=`Jarvis managed project ${job.id}`;
    journal.name=name;await save();
    phase='비공개 GitHub 저장소 준비';
    const user=await gh('user');
    if(!/^[a-zA-Z0-9-]+$/.test(user.login??''))throw fail('github_setup_failed');
    const repository=journal.repository ?? job.repository ?? `${user.login.toLowerCase()}/${name}`;
    if(job.repository && repository!==job.repository)throw fail('repository_identity_conflict');
    journal.repository=repository;await save();
    if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository)||repository.includes('..'))throw fail('invalid_repository');
    let repo=await gh(`repos/${repository}`,'GET',undefined,true);
    if(!repo && job.repository)throw fail('github_repository_unavailable');
    if(!repo){
      journal.creatingRepository=repository;await save();
      repo=await gh('user/repos','POST',{name,private:true,auto_init:true,description:marker});
    }
    if(String(repo.full_name).toLowerCase()!==repository || !job.repository && (repo.private!==true||repo.description!==marker))throw fail('repository_identity_conflict');
    if(!job.repository){
      phase='실행 코드와 자동 검증 준비';
      for(const [path,content] of Object.entries(starterFiles(plan))){
        if(journal.files?.includes(path))continue;
        const prior=await gh(`repos/${repository}/contents/${path}`,'GET',undefined,true);
        if(prior){
          if(Buffer.from(prior.content??'','base64').toString()!==content)throw fail('setup_source_changed');
        }else await gh(`repos/${repository}/contents/${path}`,'PUT',{message:'Initialize managed development environment',content:Buffer.from(content).toString('base64'),branch:repo.default_branch});
        journal.files=[...(journal.files??[]),path];await save();
      }
    }
    const result={repository,...plan,checks:[{name:'GitHub 저장소',status:'passed',detail:job.repository?'등록한 저장소 접근 확인':'비공개 저장소·초기 코드·자동 검증 명령 준비'}]};
    const provider=async(p,path,options={})=>{await pulse();return providerRequest(p,path,{token:p==='vercel'?vercelToken:supabaseToken,team:job.credentials?.vercel?.organization ?? env[prefix+'VERCEL_TEAM'],transport,signal:abort.signal,...options});};
    if(plan.database==='supabase'){
      phase='Supabase 데이터 환경 준비';
      const list=await provider('supabase','/v1/projects');
      let db=list.find(p=>p.name===name&&(p.organization_slug??p.organization_id)===organization);
      if(db && !journal.supabaseId && !journal.creatingDatabase)throw fail('database_identity_conflict');
      if(!db){journal.creatingDatabase=true;await save();db=await provider('supabase','/v1/projects',{method:'POST',body:{name,organization_slug:organization,region:env[prefix+'SUPABASE_REGION']||'ap-northeast-2',db_pass:randomBytes(32).toString('base64url')}});}
      db.id=db.ref??db.id;
      if(!/^[a-z]{20}$/.test(db.id??''))throw fail('supabase_setup_failed');
      journal.supabaseId=db.id;await save();result.supabaseProjectId=db.id;
      // Credentials are deliberately outside both Git and the model checkout.
      let healthy=false;
      phase='Supabase 생성·응답 확인';
      for(let attempt=0;attempt<60;attempt++){const state=await provider('supabase',`/v1/projects/${db.id}`);if(state.status==='ACTIVE_HEALTHY'){healthy=true;break;}await delay(5000);}
      if(!healthy)throw fail('supabase_not_ready');
      const keys=await provider('supabase',`/v1/projects/${db.id}/api-keys?reveal=true`);
      const service=keys.find(k=>k.name==='service_role')?.api_key;
      if(!service)throw fail('supabase_not_ready');
      if(!journal.schemaReady){await provider('supabase',`/v1/projects/${db.id}/database/query`,{method:'POST',body:{query:'create table if not exists public.jarvis_records (key text primary key, value jsonb not null); alter table public.jarvis_records enable row level security; revoke all on public.jarvis_records from anon, authenticated; grant all on public.jarvis_records to service_role;'}});journal.schemaReady=true;await save();}
      journal.supabase={url:`https://${db.id}.supabase.co`,service};await save();
      result.checks.push({name:'Supabase',status:'passed',detail:'프로젝트·서버 전용 저장 테이블·RLS 준비 · 브라우저에 관리 키를 제공하지 않음'});
    }
    if(plan.target==='vercel'){
      phase='Vercel 배포 연결 준비';
      let project=await provider('vercel',`/v9/projects/${journal.vercelId??name}`,{missing:true});
      if(project && !journal.vercelId && !journal.creatingVercel)throw fail('deployment_identity_conflict');
      if(!project){journal.creatingVercel=true;await save();project=await provider('vercel','/v11/projects',{method:'POST',body:{name,framework:null,gitRepository:{type:'github',repo:repository},outputDirectory:'public',buildCommand:null,installCommand:null,ssoProtection:{deploymentType:'all_except_custom_domains'}}});}
      if(!/^prj_[a-zA-Z0-9]+$/.test(project.id??'')||project.link?.repo && project.link.repo!==repository.split('/')[1]||project.link?.repoId && String(project.link.repoId)!==String(repo.id))throw fail('vercel_setup_failed');
      journal.vercelId=project.id;await save();result.vercelProjectId=project.id;
      if(journal.supabase)for(const [key,value]of Object.entries({SUPABASE_URL:journal.supabase.url,SUPABASE_SERVICE_ROLE_KEY:journal.supabase.service}))await provider('vercel',`/v10/projects/${project.id}/env?upsert=true`,{method:'POST',body:{key,value,type:'encrypted',target:['production','preview']}});
      if(!journal.deploymentRequested){const deployments=await provider('vercel',`/v6/deployments?projectId=${project.id}&limit=20`);const existing=deployments.deployments?.find(d=>d.meta?.jarvisSetup===job.id);if(!existing)await provider('vercel','/v13/deployments',{method:'POST',body:{name,project:project.id,target:'production',gitSource:{type:'github',repoId:repo.id,ref:repo.default_branch},meta:{jarvisSetup:job.id}}});journal.deploymentRequested=true;await save();}
      result.checks.push({name:'Vercel',status:'passed',detail:'저장소 자동 배포 연결 준비 · 실제 배포 성공은 개발 결과에서 별도 확인'});
    }else result.checks.push({name:'맥미니 실행',status:'passed',detail:'프로젝트별 격리 실행과 데이터 보관을 사용합니다. 실제 앱 실행은 화면 준비에서 확인합니다.'});
    if(plan.database==='sqlite')result.checks.push({name:'데이터 저장',status:'passed',detail:'Node SQLite 연결 모듈 준비 · 프로젝트 전용 데이터 경로 사용'});
    journal.result=result;await save();await pulse();
    await client.request('/api/automation/provision',{...identity,phase:'result',result});
    log('프로젝트 개발 환경 준비 결과를 저장했습니다.');
  }catch(e){
    if(!abort.signal.aborted)await client.request('/api/automation/provision',{...identity,phase:'error',code:/^[a-z_]{1,100}$/.test(e.code??'')?e.code:'setup_failed'}).catch(()=>{});
    log('프로젝트 자동 준비를 완료하지 못했습니다. Jarvis에서 원인과 이어서 준비를 확인할 수 있습니다.');
  }finally{clearInterval(timer);abort.abort();}
}
