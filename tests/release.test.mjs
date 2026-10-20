import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inspectRelease,cloudApi,advanceRelease,migrationQuery} from '../src/lib/releases/engine.mjs';
import {runReleaseWorker} from '../scripts/cloud-release-worker.mjs';
import {releaseProvider,releaseCredentials,releaseRepo,releaseSha,databaseRef} from './support/release-provider.mjs';
const project={id:'release-test',space:'personal',name:'Synthetic',description:'A web app'};
async function setup(database='none'){
 const f=releaseProvider(),api=cloudApi(releaseCredentials,f.transport),plan=await inspectRelease({project,repository:releaseRepo,ownerId:'owner',database},api,releaseCredentials);
 let saved={id:randomUUID(),status:'running',phase:'database',plan,history:[]};
 const checkpoint=async value=>{saved=structuredClone(value);};
 return{...f,api,plan,current:()=>saved,advance:async()=>{saved=await advanceRelease(saved,api,releaseCredentials,checkpoint,f.transport);return saved;}};
}
test('cloud release deploys the pinned source and checks deployment/project/alias/HTTP before completion',async()=>{
 const f=await setup();for(let i=0;i<10&&f.current().status!=='deployed';i++)await f.advance();
 assert.equal(f.current().status,'deployed');assert.equal(f.current().healthStatus,200);
 const call=f.state.requests.find(r=>r.path==='/v13/deployments'&&r.method==='POST');assert.equal(call.body.gitSource.sha,releaseSha);assert.equal(call.body.gitSource.ref,releaseSha);
 assert(!f.state.requests.some(r=>JSON.stringify(r.body??{}).includes('ssoProtection')));
});
test('new DB uses immutable migration contents, no admin credentials enter the deployment and creation happens once',async()=>{
 const f=await setup('new');let query;f.state.onSchema=sql=>{query=sql;};
 for(let i=0;i<12&&f.current().status!=='deployed';i++)await f.advance();
 assert.equal(f.current().databaseId,databaseRef);assert.match(query,/pg_advisory_xact_lock/);assert.match(query,/execute \$jarvis_/);assert.equal(f.current().migrationsApplied.length,1);
 const body=JSON.stringify(f.state.requests.filter(r=>r.host==='api.vercel.com'));assert(!body.includes('NEVER-SEND-ADMIN'));assert(body.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'));
 assert.equal(f.state.requests.filter(r=>r.path==='/v1/projects'&&r.method==='POST').length,1);
});
test('existing DB is verified in its organization and its schema and business data are never written',async()=>{
 const f=releaseProvider();f.state.database={id:databaseRef,organization_slug:'free-org',status:'ACTIVE_HEALTHY'};
 const api=cloudApi(releaseCredentials,f.transport),plan=await inspectRelease({project,repository:releaseRepo,ownerId:'owner',database:'existing',databaseId:databaseRef},api,releaseCredentials);
 const r=await advanceRelease({id:randomUUID(),status:'running',phase:'database',plan},api,releaseCredentials,async()=>{},f.transport);
 assert.equal(r.phase,'environment');assert(!f.state.requests.some(r=>r.host==='api.supabase.com'&&r.method!=='GET'));
});
test('paid account and local SQLite are rejected before any resource is created',async()=>{
 for(const kind of ['paid','sqlite']){const f=releaseProvider();if(kind==='paid')f.state.plan='pro';else f.state.files['storage.mjs']="import{DatabaseSync}from'node:sqlite';";
 await assert.rejects(inspectRelease({project,repository:releaseRepo,ownerId:'owner',database:'none'},cloudApi(releaseCredentials,f.transport),releaseCredentials),new RegExp(kind==='paid'?'free_vercel_required':'local_storage_requires_conversion'));
 assert(!f.state.requests.some(r=>r.method!=='GET'));}
});
test('uncertain resource creation persists intent and recovery cannot blindly duplicate a POST',async()=>{
 const f=await setup();await f.advance();f.state.rejectCreate=true;
 await assert.rejects(f.advance(),/synthetic_lost/);assert.equal(f.current().vercelIntent,true);
 f.state.rejectCreate=false;await assert.rejects(f.advance(),/resource_creation_uncertain/);
 assert.equal(f.state.requests.filter(r=>r.path==='/v11/projects'&&r.method==='POST').length,1);
 f.state.project={id:'prj_fixture',accountId:'fixture-account',link:{repoId:77}};assert.equal((await f.advance()).phase,'deployment');
});
test('wrong repo, moving alias, wrong commit and protected deployment cannot be called ready',async()=>{
 for(const kind of ['repo','alias','sha','protected']){const f=await setup();await f.advance();await f.advance();await f.advance();
 if(kind==='repo'){f.state.project.link.repoId=99;await f.advance();await assert.rejects(f.advance(),/deployment_source_mismatch|deployment_repository_mismatch/);continue;}
 if(kind==='sha'){f.state.deployment.meta.githubCommitSha='b'.repeat(40);await assert.rejects(f.advance(),/deployment_source_mismatch/);continue;}
 await f.advance();if(kind==='alias')f.state.deployment.id='dpl_other';else f.state.health=401;
 if(kind==='alias')await assert.rejects(f.advance(),/deployment_alias_changed/);else assert.equal((await f.advance()).error,'deployment_access_review');}
});
test('cloud worker continues multiple bounded steps and stops on revoked or failed grants without logging a ticket',async()=>{
 let n=0;const logs=[];const transport=async(url,options)=>{assert.equal(new URL(url).pathname,'/api/projects/release/step');assert.equal(JSON.parse(options.body).ticket,'synthetic_ticket');return Response.json({status:++n<4?'running':'deployed',phase:n<4?'deployment_wait':'done',retryAfter:1});};
 await runReleaseWorker({origin:'https://jarvis.invalid',ticket:'synthetic_ticket',transport,delay:async()=>{},log:v=>logs.push(v)});assert.equal(n,4);assert(!logs.join('').includes('synthetic_ticket'));
 await assert.rejects(runReleaseWorker({origin:'https://jarvis.invalid',ticket:'synthetic_ticket',transport:async()=>new Response('',{status:403}),delay:async()=>{},log:()=>{}}),/denied/);
});
test('migration wrapper journals exact immutable hashes and rejects delimiter injection',()=>{
 const query=migrationQuery([{path:'supabase/migrations/a.sql',sha:'a'.repeat(40),text:'create table sample(id int);'}]);assert.match(query,/migration_changed/);assert.match(query,/revoke all on schema/);
 assert.throws(()=>migrationQuery([{path:'x',sha:'a'.repeat(40),text:'$jarvis_'+'a'.repeat(40)+'$'}]),/invalid_migration/);
});
test('automatic selection follows committed DB schema and discovers an existing matching deployment without replacing an unknown DB',async()=>{
 const f=releaseProvider(),api=cloudApi(releaseCredentials,f.transport);
 const plan=await inspectRelease({project,repository:releaseRepo,ownerId:'owner'},api,releaseCredentials);assert.equal(plan.database,'new');
 f.state.project={id:'prj_fixture',accountId:'fixture-account',link:{repoId:77}};
 await assert.rejects(inspectRelease({project,repository:releaseRepo,ownerId:'owner'},api,releaseCredentials),/existing_database_selection_required/);
 const reused=await inspectRelease({project,repository:releaseRepo,ownerId:'owner',database:'none'},api,releaseCredentials);assert.equal(reused.vercelId,'prj_fixture');
});
test('unfinished GitHub checks block deployment, while transient worker errors retry the same scoped request',async()=>{
 const f=releaseProvider();const transport=async(url,opts)=>new URL(url).pathname.endsWith('/check-runs')?Response.json({total_count:1,check_runs:[{status:'in_progress'}]}):f.transport(url,opts);
 await assert.rejects(inspectRelease({project,repository:releaseRepo,ownerId:'owner',database:'none'},cloudApi(releaseCredentials,transport),releaseCredentials),/source_checks_pending/);
 let attempts=0;await runReleaseWorker({origin:'https://jarvis.invalid',ticket:'synthetic_ticket',delay:async()=>{},log:()=>{},transport:async()=>++attempts===1?new Response('',{status:503}):Response.json({status:'deployed',phase:'done'})});assert.equal(attempts,2);
});
