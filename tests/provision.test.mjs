import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {executeProvision,starterFiles,chooseEnvironment,setupName,providerRequest} from '../public/jarvis-provision.mjs';
import {runCommand} from '../public/jarvis-runner.mjs';
import {sealProvider,openProvider} from '../src/lib/automation/provider-vault.mjs';
import {newerVersion} from '../public/jarvis-supervisor.mjs';
const job={kind:'provision',id:'12345678-1234-1234-1234-123456789012',projectId:'new-project',space:'personal',leaseToken:'lease',name:'새 프로젝트',description:'메모 저장',target:'auto',database:'auto'};
function harness({failAt}={}){
 let repo=null,creates=0,writes=0,failed=false;const files=new Map(),reports=[];
 const client={request:async(path,body)=>{assert.equal(path,'/api/automation/provision');reports.push(body);return{accepted:true};}};
 const run=async(bin,args,options)=>{
  if(bin==='docker')return{code:0,out:'29.0',err:''};
  assert.equal(bin,'gh');const method=args[args.indexOf('--method')+1],path=args[args.indexOf('--method')+2];
  const body=options.input?JSON.parse(options.input):null;
  if(path==='user')return{code:0,out:JSON.stringify({login:'example'}),err:''};
  if(path==='user/repos'){assert.equal(body.private,true);assert.equal(body.auto_init,true);creates++;repo={full_name:'example/'+body.name,private:true,description:body.description,default_branch:'main',id:123};return{code:0,out:JSON.stringify(repo),err:''};}
  if(method==='GET'&&!path.includes('/contents/'))return repo?{code:0,out:JSON.stringify(repo),err:''}:{code:1,out:'',err:'HTTP 404 Not Found'};
  const file=path.split('/contents/')[1];assert(file);
  if(method==='GET')return files.has(file)?{code:0,out:JSON.stringify({content:files.get(file)}),err:''}:{code:1,out:'',err:'HTTP 404 Not Found'};
  if(failAt===file&&!failed){failed=true;return{code:1,out:'',err:'HTTP 502'};}
  assert.equal(method,'PUT');files.set(file,body.content);writes++;return{code:0,out:'{}',err:''};
 };
 return{client,run,files,reports,get creates(){return creates;},get writes(){return writes;}};
}
test('private repository preparation resumes partial writes, reuses identity and redelivers result without duplicate resources',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-provision-'));try{
 const h=harness({failAt:'server.mjs'});const options={stateDir:dir,run:h.run,env:{},log(){},transport(){throw Error('unexpected outbound');}};
 await executeProvision(h.client,job,options);assert.equal(h.creates,1);assert.equal(h.reports.at(-1).phase,'error');
 await executeProvision(h.client,{...job,name:'Renamed during retry'},options);const result=h.reports.at(-1).result;assert.equal(result.repository,'example/'+setupName(job));assert.equal(result.target,'mac');assert.equal(result.database,'sqlite');assert.equal(h.creates,1);assert.equal(h.writes,Object.keys(starterFiles(result)).length);
 const count=h.writes;await executeProvision(h.client,job,options);assert.equal(h.writes,count);assert.equal(h.creates,1);
 assert(!JSON.stringify(result).includes('token'));
 const app=join(dir,'app');for(const[path,content]of h.files){await mkdir(dirname(join(app,path)),{recursive:true});await writeFile(join(app,path),Buffer.from(content,'base64'));}
 const checked=await runCommand('npm',['test'],{cwd:app,env:{PATH:process.env.PATH},timeout:30000});assert.equal(checked.code,0,checked.out+checked.err);assert.match(checked.out,/pass 1/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('account absence chooses a working Mac path and explicit cloud choices fail before writes',async()=>{
 assert.equal(chooseEnvironment(job,{}).target,'mac');assert.equal(chooseEnvironment({...job,description:'정적 웹 그래프'}, {vercel:true}).target,'vercel');
 assert.equal(chooseEnvironment({...job,description:'실시간 CLI 서버'}, {vercel:true}).target,'mac');
 assert.throws(()=>chooseEnvironment({...job,target:'vercel'},{}),/vercel_connection_required/);
 assert.throws(()=>chooseEnvironment({...job,database:'supabase'},{}),/supabase_connection_required/);
 assert.notEqual(setupName(job),setupName({...job,space:'company'}));assert.notEqual(setupName(job),setupName({...job,projectId:'another'}));
});
test('cancelled lease prevents all GitHub/provider operations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-provision-'));try{await executeProvision({request:async()=>{throw Error('cancelled');}},job,{stateDir:dir,run(){assert.fail('must not run');},env:{},log(){}});}finally{await rm(dir,{recursive:true,force:true});}
});
test('provider transport only sends credentials to exact HTTPS origin with redirects forbidden',async()=>{
 let calls=0;await providerRequest('vercel','/v9/projects',{token:'synthetic-private',team:'team_fixture',transport:async(url,options)=>{calls++;assert.equal(url.origin,'https://api.vercel.com');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('teamId'),'team_fixture');assert.equal(options.headers.Authorization,'Bearer synthetic-private');return new Response('{}');}});assert.equal(calls,1);
 await assert.rejects(providerRequest('vercel','https://evil.invalid',{token:'synthetic'}));
});
test('cloud credentials are authenticated encrypted and bound to owner, space and provider',()=>{
 const secret='s'.repeat(48), value={token:'synthetic-provider-token',organization:'fixture'};const sealed=sealProvider(value,secret,'owner','personal','vercel');
 assert(!sealed.includes(value.token));assert.deepEqual(openProvider(sealed,secret,'owner','personal','vercel'),value);
 for(const args of [['other','personal','vercel'],['owner','company','vercel'],['owner','personal','supabase']])assert.throws(()=>openProvider(sealed,secret,...args));
 assert.throws(()=>openProvider(sealed.slice(0,-4)+'aaaa',secret,'owner','personal','vercel'));
});
test('automatic upgrades never downgrade or cross unsupported major version',()=>{assert(newerVersion('2.10.0','2.9.9'));assert(!newerVersion('2.5.2','2.6.0'));assert(!newerVersion('3.0.0','2.6.0'));assert(!newerVersion('2.6.0','2.6.0'));});
test('verified updates stage separately and reject corrupt or failed candidates without replacing installed runtime',async()=>{
 const {stageUpdate}=await import('../public/jarvis-supervisor.mjs');const {createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'jarvis-updater-'));try{
  const runtime=join(dir,'current');await mkdir(runtime);await writeFile(join(runtime,'jarvis-runtime.json'),JSON.stringify({version:'2.6.0'}));await writeFile(join(runtime,'cloudflared'),'synthetic tunnel');
  const names=['jarvis-runner.mjs','jarvis-preview.mjs','jarvis-development.mjs','jarvis-remote-preview.mjs','jarvis-preview-auth.mjs','jarvis-preview-cli.mjs','jarvis-provision.mjs','jarvis-supervisor.mjs','jarvis-mac.mjs'];const bytes='// verified synthetic runtime\n',hash=createHash('sha256').update(bytes).digest('hex');
  const manifest={version:'2.6.1',files:Object.fromEntries(names.map(n=>[n,hash]))};
  const transport=async(url,options)=>{assert.equal(options.redirect,'error');return new Response(url.endsWith('jarvis-runtime.json')?JSON.stringify(manifest):bytes);};
  const candidate=await stageUpdate({runtime,directory:dir,origin:'https://fixture.invalid',transport,run:async(bin,args)=>{assert.equal(bin,process.execPath);assert.equal(args.at(-1),'--self-check');return{code:0};}});
  assert.notEqual(candidate,runtime);assert.equal(await readFile(join(candidate,'cloudflared'),'utf8'),'synthetic tunnel');assert.equal(JSON.parse(await readFile(join(runtime,'jarvis-runtime.json'),'utf8')).version,'2.6.0');
  await assert.rejects(stageUpdate({runtime,directory:dir,origin:'https://fixture.invalid',transport,run:async()=>({code:1})}),/self_check/);
  manifest.files['jarvis-provision.mjs']='f'.repeat(64);await assert.rejects(stageUpdate({runtime,directory:dir,origin:'https://fixture.invalid',transport,run:async()=>{assert.fail('unverified code must not execute');}}),/무결성/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('configured free cloud path initializes private database and deploys with encrypted server settings, without exposing secrets in results',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-cloud-setup-'));try{
 const h=harness();const calls=[];const db='abcdefghijklmnopqrst';const cloudJob={...job,target:'vercel',database:'supabase',credentials:{vercel:{token:'synthetic-vercel-token'},supabase:{token:'synthetic-supabase-token',organization:'org-fixture'}}};
 const transport=async(url,options)=>{url=new URL(url);const body=options.body?JSON.parse(options.body):null;calls.push({path:url.pathname,body});assert.equal(options.redirect,'error');let result;
  if(url.pathname==='/v2/user')result={user:{billing:{plan:'hobby'}}};
  else if(url.pathname==='/v1/organizations')result=[{id:'org-fixture',slug:'org-fixture'}];
  else if(url.pathname==='/v1/organizations/org-fixture')result={plan:'free'};
  else if(url.pathname==='/v1/projects'&&options.method==='GET')result=[];
  else if(url.pathname==='/v1/projects'){assert.equal(body.plan,undefined);assert.equal(body.organization_slug,'org-fixture');assert.equal(body.desired_instance_size,undefined);assert(body.db_pass.length>=32);result={id:db};}
  else if(url.pathname===`/v1/projects/${db}`)result={status:'ACTIVE_HEALTHY'};
  else if(url.pathname.endsWith('/api-keys'))result=[{name:'service_role',api_key:'synthetic-service-role-secret'}];
  else if(url.pathname.endsWith('/database/query')){assert.match(body.query,/enable row level security/);assert.match(body.query,/revoke all/);result=[];}
  else if(url.pathname.startsWith('/v9/projects/'))return new Response('{}',{status:404});
  else if(url.pathname==='/v11/projects'){assert.equal(body.ssoProtection.deploymentType,'all_except_custom_domains');result={id:'prj_fixture'};}
  else if(url.pathname.endsWith('/env')){assert.equal(body.type,'encrypted');assert.deepEqual(body.target,['production','preview']);result={};}
  else if(url.pathname==='/v6/deployments')result={deployments:[]};
  else if(url.pathname==='/v13/deployments'){assert.equal(body.meta.jarvisSetup,job.id);assert.equal(body.gitSource.repoId,123);result={id:'dpl_fixture'};}
  else assert.fail('unexpected '+url);return new Response(JSON.stringify(result));
 };
 await executeProvision(h.client,cloudJob,{stateDir:dir,run:h.run,env:{},transport,log(){}});
 const last=h.reports.at(-1);assert.equal(last.phase,'result',JSON.stringify(last));assert.equal(last.result.supabaseProjectId,db);assert.equal(last.result.vercelProjectId,'prj_fixture');assert(!JSON.stringify(last).includes('synthetic-service-role-secret'));assert(!JSON.stringify(last).includes('synthetic-vercel-token'));
 assert(h.files.has('api/records.mjs'));assert(calls.some(c=>c.path.endsWith('/database/query')));assert.equal(calls.filter(c=>c.path.endsWith('/env')).length,2);
 const count=calls.length;await executeProvision(h.client,cloudJob,{stateDir:dir,run:h.run,env:{},transport,log(){}});assert.equal(calls.length,count);assert.equal(h.creates,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('supervisor restores the previous verified runtime when a candidate passes syntax but cannot start',async()=>{
 const {supervise}=await import('../public/jarvis-supervisor.mjs');const {spawn}=await import('node:child_process');const {createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'jarvis-supervisor-'));const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),10000);let oldStarts=0;
 try{
  const runtime=join(dir,'installed');await mkdir(runtime);await writeFile(join(runtime,'jarvis-runtime.json'),JSON.stringify({version:'2.6.0'}));await writeFile(join(runtime,'cloudflared'),'synthetic tunnel');
  await writeFile(join(runtime,'jarvis-runner.mjs'),"process.send({type:'ready'});process.send({type:'idle',activePreviews:0});process.on('message',()=>{});setInterval(()=>{},10000);");
  const config=join(dir,'config.json');await writeFile(config,JSON.stringify({origin:'https://synthetic.invalid'}));
  const names=['jarvis-runner.mjs','jarvis-preview.mjs','jarvis-development.mjs','jarvis-remote-preview.mjs','jarvis-preview-auth.mjs','jarvis-preview-cli.mjs','jarvis-provision.mjs','jarvis-supervisor.mjs','jarvis-mac.mjs'];const source="if(process.argv.includes('--self-check'))process.exit(0);process.exit(1);";
  const manifest={version:'2.6.1',files:Object.fromEntries(names.map(name=>[name,createHash('sha256').update(source).digest('hex')]))};
  const transport=async url=>new Response(url.endsWith('jarvis-runtime.json')?JSON.stringify(manifest):source);
  await supervise({runtime,directory:dir,config,transport,signal:abort.signal,spawnProcess:(bin,args,options)=>{const child=spawn(bin,args,options);if(args[0]===join(runtime,'jarvis-runner.mjs')){oldStarts++;if(oldStarts===2)child.on('message',m=>{if(m.type==='ready')setTimeout(()=>abort.abort(),20);});}return child;}});
  assert.equal(oldStarts,2);assert.equal(JSON.parse(await readFile(join(dir,'runtime-current.json'),'utf8')).runtime,runtime);
 }finally{clearTimeout(timeout);abort.abort();await rm(dir,{recursive:true,force:true});}
});
test('generated cloud storage handler writes and reads through its server credential and rejects cross-site writes',async()=>{
 const {pathToFileURL}=await import('node:url');const dir=await mkdtemp(join(tmpdir(),'jarvis-generated-api-'));const original=globalThis.fetch;
 const priorUrl=process.env.SUPABASE_URL,priorKey=process.env.SUPABASE_SERVICE_ROLE_KEY;let value={count:0},calls=0;
 try{
  const files=starterFiles({target:'vercel',database:'supabase'});for(const name of ['storage.mjs','api/records.mjs']){await mkdir(dirname(join(dir,name)),{recursive:true});await writeFile(join(dir,name),files[name]);}
  process.env.SUPABASE_URL='https://synthetic-db.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-server-only';
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(new URL(url).origin,'https://synthetic-db.invalid');assert.equal(options.headers.Authorization,'Bearer synthetic-server-only');if(options.method==='POST'){const body=JSON.parse(options.body);assert.equal(body.key,'counter');value=body.value;return new Response('',{status:201});}return new Response(JSON.stringify([{value}]));};
  const {default:handler}=await import(pathToFileURL(join(dir,'api/records.mjs')));
  const invoke=async(method,origin,body)=>{const response={code:200,body:null,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};await handler({method,headers:{host:'app.synthetic.invalid',origin},query:{key:'counter'},body},response);return response;};
  assert.equal((await invoke('POST','https://evil.invalid',{count:1})).code,403);assert.equal(calls,0);
  const saved=await invoke('POST','https://app.synthetic.invalid',{count:7});assert.equal(saved.code,200);assert.deepEqual(saved.body,{saved:true});
  const loaded=await invoke('GET');assert.deepEqual(loaded.body,{value:{count:7}});assert(!JSON.stringify(loaded.body).includes('synthetic-server-only'));
 }finally{globalThis.fetch=original;if(priorUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=priorUrl;if(priorKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=priorKey;await rm(dir,{recursive:true,force:true});}
});

test('Mac project registration prepares a private repository without requiring Docker or querying cloud accounts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-native-setup-'));const h=harness();
 try{await executeProvision(h.client,{...job,target:'mac'},{stateDir:dir,platform:'darwin',env:{JARVIS_PERSONAL_VERCEL_TOKEN:'synthetic-not-transmitted',JARVIS_PERSONAL_SUPABASE_TOKEN:'synthetic-not-transmitted',JARVIS_PERSONAL_SUPABASE_ORG:'synthetic'},transport(){assert.fail('Mac development must not contact production cloud providers');},run:async(bin,args,opts)=>{assert.notEqual(bin,'docker');return h.run(bin,args,opts);},log(){}});assert.equal(h.reports.at(-1).phase,'result');assert.equal(h.creates,1);}finally{await rm(dir,{recursive:true,force:true});}
});
