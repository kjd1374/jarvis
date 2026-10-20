import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const releaseSha='a'.repeat(40),databaseRef='b'.repeat(20),releaseRepo='example/release-fixture';
export function releaseProvider(){
 const files={'package.json':JSON.stringify({private:true,dependencies:{next:'16.4.0'}}),'app/page.tsx':'export default function Page(){return <h1>Fixture</h1>}', 'supabase/migrations/001_fixture.sql':'create table public.synthetic_records(id text primary key,value jsonb); alter table public.synthetic_records enable row level security;'};
 const blob=path=>{const bytes=Buffer.from(files[path]);return{type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64'),sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};};
 const state={files,requests:[],project:null,database:null,deployment:null,dispatch:null,head:releaseSha,health:200,plan:'hobby',orgPlan:'free',rejectCreate:false,onSchema:null,onDispatch:null};
 const handle=async(url,method='GET',body,headers={})=>{
  const u=new URL(url),p=u.pathname;state.requests.push({host:u.host,path:p,method,body});
  if(u.hostname==='synthetic-release.vercel.app'){assert.equal(headers.Authorization,undefined);return{status:state.health,body:'<h1>Synthetic released app</h1>',html:true};}
  if(u.hostname==='api.github.com'){
   if(p==='/user')return{body:{login:'fixture-owner'}};
   if(p==='/repos/kjd1374/jarvis')return{body:{private:false,full_name:'kjd1374/jarvis',id:1}};
   if(p.endsWith('/actions/workflows/project-release.yml/dispatches')){state.dispatch=body;await state.onDispatch?.(body);return{body:{html_url:'https://github.com/kjd1374/jarvis/actions/runs/123'}};}
   if(p===`/repos/${releaseRepo}`)return{body:{full_name:releaseRepo,id:77,default_branch:'main',private:true}};
   if(p.endsWith('/check-runs'))return{body:{total_count:1,check_runs:[{name:'synthetic tests',status:'completed',conclusion:'success'}]}};
   if(p.endsWith('/status'))return{body:{state:'success',total_count:1}};
   if(p.startsWith(`/repos/${releaseRepo}/commits/`))return{body:{sha:state.head}};
   if(p.startsWith(`/repos/${releaseRepo}/git/trees/`))return{body:{truncated:false,tree:Object.keys(files).map(path=>({path,type:'blob',sha:blob(path).sha}))}};
   if(p.startsWith(`/repos/${releaseRepo}/contents/`)){const path=p.split('/contents/')[1];return files[path]===undefined?{status:404,body:{}}:{body:blob(path)};}
  }
  if(u.hostname==='api.vercel.com'){
   if(p==='/v2/user')return{body:{user:{id:'fixture-account',billing:{plan:state.plan}}}};
   if(p==='/v9/projects')return{body:{projects:state.project?[state.project]:[]}};
   if(p.startsWith('/v9/projects/'))return state.project?{body:state.project}:{status:404,body:{}};
   if(p==='/v11/projects'&&method==='POST'){if(state.rejectCreate)throw Error('synthetic_lost_creation_response');state.project={id:'prj_fixture',accountId:'fixture-account',name:body.name,link:{repoId:77}};return{body:state.project};}
   if(p.endsWith('/env')&&method==='POST'){assert(!JSON.stringify(body).includes('NEVER-SEND-ADMIN'));return{body:{created:true}};}
   if(p==='/v6/deployments')return{body:{deployments:state.deployment?[state.deployment]:[]}};
   if(p==='/v13/deployments'&&method==='POST'){state.deployment={id:'dpl_fixture',uid:'dpl_fixture',projectId:'prj_fixture',target:'production',readyState:'READY',url:'synthetic-release.vercel.app',meta:{...body.meta,githubCommitSha:body.gitSource.sha}};return{body:state.deployment};}
   if(p==='/v13/deployments/dpl_fixture')return{body:state.deployment};
   if(p==='/v2/deployments/dpl_fixture/aliases')return{body:{aliases:[{alias:'synthetic-release.vercel.app'}]}};
   if(p==='/v4/aliases/synthetic-release.vercel.app')return{body:{deployment:{id:state.deployment?.id}}};
  }
  if(u.hostname==='api.supabase.com'){
   if(p==='/v1/organizations')return{body:[{id:'free-org',slug:'free-org'}]};
   if(p==='/v1/organizations/free-org')return{body:{plan:state.orgPlan}};
   if(p==='/v1/projects'&&method==='GET')return{body:state.database?[state.database]:[]};
   if(p==='/v1/projects'&&method==='POST'){state.database={id:databaseRef,name:body.name,organization_slug:'free-org',status:'ACTIVE_HEALTHY'};return{body:state.database};}
   if(p===`/v1/projects/${databaseRef}`)return state.database?{body:state.database}:{status:404,body:{}};
   if(p===`/v1/projects/${databaseRef}/database/query`){await state.onSchema?.(body.query);return{body:[]};}
   if(p===`/v1/projects/${databaseRef}/api-keys`)return{body:[{name:'anon',api_key:'synthetic-anon-key'},{name:'service_role',api_key:'NEVER-SEND-ADMIN'}]};
  }
  throw Error('Unexpected synthetic provider call: '+method+' '+u.origin+p);
 };
 const transport=async(url,options={})=>{const r=await handle(url,options.method??'GET',options.body?JSON.parse(options.body):undefined,options.headers);return new Response(r.html?r.body:JSON.stringify(r.body),{status:r.status??200,headers:{'Content-Type':r.html?'text/html':'application/json'}});};
 return{state,handle,transport};
}
export const releaseCredentials={github:{token:'synthetic-github-token'},vercel:{token:'synthetic-vercel-token'},supabase:{token:'synthetic-supabase-token',organization:'free-org'}};
