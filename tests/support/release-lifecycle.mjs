import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import {runReleaseWorker} from '../../scripts/cloud-release-worker.mjs';
import {migrationQuery} from '../../src/lib/releases/engine.mjs';
import {releaseRepo} from './release-provider.mjs';
export async function runReleaseLifecycle({base,api,account,sql,users,network,recordCheck}){
 const projectId='cloud-release-'+randomUUID(),space='personal',stamp=new Date().toISOString(),dbName='jarvis_release_test_'+randomUUID().replaceAll('-','');
 const dbSQL=query=>execFileSync('docker',['exec','-i','supabase_db_jarvis','psql','-U','postgres','-d',dbName,'-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 let browser,context,page,deviceId,schemaQuery;
 try{
  sql(`create database ${dbName}`);
  network.release.state.onSchema=query=>{schemaQuery=query;dbSQL(query);};
  for(const provider of ['github','vercel','supabase']){
   const saved=await api('/api/automation/providers',account.token,'POST',{space,provider,action:'connect',token:'synthetic-'+provider+'-token',...(provider==='supabase'?{organization:'free-org'}:{})});assert.equal(saved.status,200,JSON.stringify(saved.body));
  }
  const before=await api('/api/workspace?space='+space,account.token);before.body.data.projects.push({id:projectId,space,name:'합성 클라우드 운영 전환',description:'합성 웹 앱',stage:'development',createdAt:stamp});
  before.body.data.services.push({id:'github-'+projectId,space,projectId,name:'GitHub',webUrl:'https://github.com/'+releaseRepo,repositoryUrl:'https://github.com/'+releaseRepo,connector:'shortcut',favorite:true,createdAt:stamp,lastSuccessAt:null,lastAttemptAt:null,connectionStatus:'shortcut',error:null,failures:0,nextRetryAt:null});
  assert.equal((await api('/api/workspace',account.token,'PUT',{space,data:before.body.data,revision:before.body.revision})).status,200);
  assert([401,403].includes((await api('/api/projects/release',undefined,'POST',{space,projectId,action:'plan'})).status));
  assert.equal((await api('/api/projects/release',account.token,'POST',{space:'company',projectId,action:'plan'})).status,409);
  browser=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{});context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  page=await context.newPage();await page.goto(base+'/settings');await page.getByText(/기기 확인 번호:/).waitFor();
  const status=await(await context.request.get(base+'/api/account')).json();assert.match(status.pairingCode,/^[A-F0-9]{12}$/);
  deviceId=sql(`select user_id from public.jarvis_devices where request_code='${status.pairingCode}'`);assert.match(deviceId,/^[a-f0-9-]{36}$/);users.push(deviceId);sql(`update public.jarvis_devices set approved_at=now() where user_id='${deviceId}'`);
  await page.getByRole('button',{name:'기기 연결 다시 확인',exact:true}).click();await page.getByRole('button',{name:'개인',exact:true}).click();await expect(page.getByRole('button',{name:'개인',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.goto(base+'/projects/'+projectId);
  const panel=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^개발 완료·운영 전환/})}).first();
  await panel.locator(':scope > summary').click();await panel.getByLabel('운영 데이터베이스',{exact:true}).selectOption('new');await panel.getByRole('button',{name:'운영 구성 검사',exact:true}).click();
  await expect(panel.getByRole('status').filter({hasText:'운영 구성 검토'})).toBeVisible();
  await panel.getByRole('checkbox',{name:/고정 코드·무료 계정/}).check();await panel.getByRole('button',{name:'클라우드에서 배포 시작',exact:true}).click();
  await expect.poll(()=>network.release.state.dispatch?.inputs?.ticket,{timeout:30000}).toBeTruthy();
  const firstTicket=network.release.state.dispatch.inputs.ticket;
  assert.equal((await api('/api/projects/release/step',undefined,'POST',{ticket:firstTicket})).status,403);
  const snap=await api('/api/workspace?space='+space,account.token),r=snap.body.data.projects.find(p=>p.id===projectId).release;
  assert.equal(r.status,'queued');assert.equal(r.ownerDevice,deviceId);assert(!JSON.stringify(r).includes(firstTicket));
  // A normal stale browser PUT cannot forge completion or overwrite its lease.
  const forged=structuredClone(snap.body.data);forged.projects.find(p=>p.id===projectId).release.status='deployed';
  assert.equal((await api('/api/workspace',account.token,'PUT',{space,data:forged,revision:snap.body.revision})).status,200);
  assert.equal((await api('/api/workspace?space='+space,account.token)).body.data.projects.find(p=>p.id===projectId).release.status,'queued');
  assert.equal((await api('/api/projects/release',account.token,'POST',{space,projectId,jobId:r.id,action:'cancel'})).status,200);
  assert.equal((await api('/api/projects/release/step',network.release.issueIdentity(base),'POST',{ticket:firstTicket})).status,403);
  const retry=await context.request.post(base+'/api/projects/release',{headers:{Origin:base},data:{space,projectId,jobId:r.id,action:'retry',reviewed:true}});assert.equal(retry.status(),200);
  const retryTicket=network.release.state.dispatch.inputs.ticket;assert.notEqual(retryTicket,firstTicket);
  const restore=await api('/api/workspace?space='+space,account.token);
  Object.assign(restore.body.data.projects.find(p=>p.id===projectId).release,{status:'interrupted',error:'imported_request_review'});
  assert.equal((await api('/api/workspace',account.token,'PUT',{space,data:restore.body.data,revision:restore.body.revision})).status,200);
  assert.equal((await api('/api/projects/release/step',network.release.issueIdentity(base),'POST',{ticket:retryTicket})).status,403);
  const resume=await context.request.post(base+'/api/projects/release',{headers:{Origin:base},data:{space,projectId,jobId:r.id,action:'retry',reviewed:true}});assert.equal(resume.status(),200);
  const ticket=network.release.state.dispatch.inputs.ticket;assert.notEqual(ticket,retryTicket);await context.close();context=undefined;
  await runReleaseWorker({origin:'https://jarvis.invalid',ticket,getIdentityToken:async()=>network.release.issueIdentity(base),delay:async()=>{},log:()=>{},transport:(_url,options)=>fetch(base+'/api/projects/release/step',options)});
  const finished=(await api('/api/workspace?space='+space,account.token)).body.data.projects.find(p=>p.id===projectId);
  assert.equal(finished.release.status,'deployed');assert.equal(finished.stage,'development');assert.equal(finished.release.healthStatus,200);assert.equal(dbSQL("select relrowsecurity from pg_class where relname='synthetic_records'"),'t');
  dbSQL("insert into synthetic_records values('kept','{\"n\":1}')");dbSQL(schemaQuery);assert.equal(dbSQL('select count(*) from synthetic_records'),'1');
  assert.throws(()=>dbSQL(migrationQuery([{path:'atomic.sql',sha:'c'.repeat(40),text:'create table atomic_release_test(id int); select deliberately_missing_function();'}])));assert.equal(dbSQL("select count(*) from pg_class where relname='atomic_release_test'"),'0');
  assert.equal(network.release.state.requests.filter(r=>r.path==='/v1/projects'&&r.method==='POST').length,1);
  const noConsent=await api('/api/projects/release',account.token,'POST',{space,projectId,jobId:r.id,action:'complete'});assert.equal(noConsent.status,409);
  const staleConsent=await api('/api/projects/release',account.token,'POST',{space,projectId,jobId:r.id,action:'complete',functionalChecked:true,executionId:r.executionId,deploymentId:finished.release.deploymentId});assert.equal(staleConsent.status,409);
  const completed=await api('/api/projects/release',account.token,'POST',{space,projectId,jobId:r.id,action:'complete',functionalChecked:true,executionId:finished.release.executionId,deploymentId:finished.release.deploymentId});assert.equal(completed.status,200);
  const live=(await api('/api/workspace?space='+space,account.token)).body.data.projects.find(p=>p.id===projectId);assert.equal(live.stage,'live');assert.equal(live.launchUrl,'https://synthetic-release.vercel.app');
  sql(`update public.jarvis_devices set revoked_at=now() where user_id='${deviceId}'`);assert.equal((await api('/api/projects/release/step',network.release.issueIdentity(base),'POST',{ticket})).status,403);
  recordCheck('cloud release: approved browser plans/pins source -> encrypted scoped connections -> real dispatch contract -> cancellation/old grant fencing -> browser closed -> bounded worker -> actual private DB checkpoints -> new DB SQL transaction/RLS/idempotency -> immutable deployment/alias/HTTP check -> explicit functional confirmation -> live shortcut; no Mac, production or paid API calls');
 }catch(error){
  console.error('Synthetic provider calls',network.release.state.requests.map(r=>({host:r.host,path:r.path,method:r.method})));
  if(page&&!page.isClosed()){await page.screenshot({path:'/tmp/jarvis-release-failed.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-5000));}throw error;
 }finally{network.release.state.onSchema=null;await context?.close();await browser?.close();sql(`drop database if exists ${dbName} with (force)`);}
}
