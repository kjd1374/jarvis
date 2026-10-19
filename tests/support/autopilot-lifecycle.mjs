// Connected synthetic provider/model test; real browser, private server, Git, Docker, storage and HTTPS gateway.
import assert from 'node:assert/strict';import http from 'node:http';
import {execFileSync} from 'node:child_process';import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,dirname,resolve,sep} from 'node:path';import {createHash} from 'node:crypto';
import {expect} from '@playwright/test';import {executeProvision,setupName} from '../../public/jarvis-provision.mjs';
import {executeProjectWork,runCommand,VERSION} from '../../public/jarvis-runner.mjs';import * as preview from '../../public/jarvis-preview.mjs';
import {lifecycleRemote} from './lifecycle-network.mjs';
export async function runAutopilotLifecycle({base,browser,runner,network,approve,snapshot,recordCheck}){
 const directory=await mkdtemp(join(tmpdir(),'jarvis-autopilot-')),seed=join(directory,'seed'),bare=join(directory,'remote.git');
 let context,page,server,bridge,repo=null,pr=null,modelCalls=0,creates=0,project;const containers=[], statuses=new Map();
 const git=args=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:seed,env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const bareGit=args=>execFileSync('git',['--git-dir',bare,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  await mkdir(seed);git(['init','--initial-branch=main']);
  context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  await context.route('**/*',route=>{const origin=new URL(route.request().url()).origin;assert([base,new URL(lifecycleRemote).origin].includes(origin));return route.continue();});
  page=await context.newPage();await page.goto(base+'/settings');await page.getByText(/기기 확인 번호:/).waitFor();await approve(await(await context.request.get(base+'/api/account')).json());
  await page.getByRole('button',{name:'기기 연결 다시 확인',exact:true}).click();await page.getByRole('button',{name:'개인',exact:true}).click();await expect(page.getByRole('button',{name:'개인',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.goto(base+'/projects');await page.getByRole('button',{name:'프로젝트 만들기',exact:true}).click();
  const form=page.getByRole('dialog',{name:'프로젝트 만들기',exact:true});await form.getByLabel('프로젝트 이름').fill('합성 자동 개발');
  await form.getByLabel('프로젝트 설명').fill('카운터 값을 저장하는 웹 앱');await expect(form.getByRole('checkbox')).toBeChecked();await form.getByRole('button',{name:'프로젝트 저장',exact:true}).click();await expect(form).not.toBeVisible();
  await expect.poll(async()=> (await snapshot()).data.projects.find(p=>p.name==='합성 자동 개발')?.id).toBeTruthy();
  project=(await snapshot()).data.projects.find(p=>p.name==='합성 자동 개발');await page.goto(base+'/projects/'+project.id);
  const scope={space:'personal',projectIds:['old-removed-project'],provider:'codex',runnerVersion:VERSION,workVersion:1,remoteWorkVersion:1,previewVersion:1,provisionVersion:1};
  const setup=(await runner.request('/api/automation/claim',scope)).job;assert.equal(setup.kind,'provision');assert.equal(setup.projectId,project.id);
  const repository='example/'+setupName(setup);
  const setupRun=async(bin,args,options)=>{
   if(bin==='docker')return runCommand(bin,args,options);assert.equal(bin,'gh');const method=args[args.indexOf('--method')+1],path=args[args.indexOf('--method')+2],body=options.input?JSON.parse(options.input):null;
   if(path==='user')return{code:0,out:'{"login":"example"}',err:''};
   if(path==='user/repos'){assert.equal(body.private,true);creates++;repo={full_name:repository,private:true,description:body.description,default_branch:'main',id:42};return{code:0,out:JSON.stringify(repo),err:''};}
   if(path===`repos/${repository}`)return repo?{code:0,out:JSON.stringify(repo),err:''}:{code:1,out:'',err:'HTTP 404'};
   assert(path.startsWith(`repos/${repository}/contents/`));const file=path.split('/contents/')[1];
   if(method==='GET'){const content=await readFile(join(seed,file)).catch(()=>null);return content?{code:0,out:JSON.stringify({content:content.toString('base64')}),err:''}:{code:1,out:'',err:'HTTP 404'};}
   assert.equal(method,'PUT');await mkdir(dirname(join(seed,file)),{recursive:true});await writeFile(join(seed,file),Buffer.from(body.content,'base64'));git(['add','--',file]);git(['-c','user.name=Synthetic','-c','user.email=fixture@example.invalid','commit','-m','Prepare fixture']);return{code:0,out:'{}',err:''};
  };
  await executeProvision(runner,setup,{stateDir:directory,run:setupRun,env:{},log(){}});
  let current=(await snapshot()).data.projects.find(p=>p.id===project.id);assert.equal(current.setup.status,'ready',JSON.stringify(current.setup));assert.equal(creates,1);
  await executeProvision(runner,setup,{stateDir:directory,run:setupRun,env:{},log(){}});assert.equal(creates,1);
  git(['clone','--bare',seed,bare]);bareGit(['update-server-info']);
  server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);assert(name.startsWith('/remote.git/')&&!name.includes('..'));const path=await realpath(resolve(directory,'.'+name));assert(path.startsWith(bare+sep));res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const gitUrl=`http://127.0.0.1:${server.address().port}/remote.git`;
  const get=async path=>{
   if(path===`repos/${repository}`)return repo;
   if(path===`repos/${repository}/commits/main`)return{sha:bareGit(['rev-parse','main'])};
   if(path.includes('/check-runs?'))return{total_count:0,check_runs:[]};
   if(path.includes('/status?'))return{total_count:1,statuses:[{state:statuses.get(path.split('/commits/')[1].split('/')[0])}]};
   if(path.includes('/deployments?'))return[];
   if(path.includes('/pulls?'))return pr&&path.includes(encodeURIComponent(pr.head.ref))?[pr]:[];
   if(path.match(/\/pulls\/\d+$/))return pr;
   throw Error('unexpected GitHub '+path);
  };
  const run=async(bin,args,options)=>{
   if(bin==='git'&&args.includes('clone')){const i=args.indexOf(`https://github.com/${repository}.git`);assert(i>=0);return runCommand(bin,args.with(i,gitUrl),options);}
   if(bin==='git'&&args.includes('push')){const branch=args.at(-1).split('refs/heads/')[1];const r=await runCommand('git',['-c','core.hooksPath=/dev/null','-c','protocol.file.allow=always','push',bare,`HEAD:refs/heads/${branch}`],options);bareGit(['update-server-info']);return r;}
   if(bin==='gh'){
    if(args.includes('POST')&&args.some(a=>a.includes('/statuses/'))){const sha=args.find(a=>a.includes('/statuses/')).split('/').at(-1);const state=args.find(a=>a.startsWith('state=')).slice(6);assert(['success','failure'].includes(state));statuses.set(sha,state);return{code:0,out:'{}',err:''};}
    if(args[0]==='pr'){const branch=args[args.indexOf('--head')+1];pr={number:1,state:'open',merged:false,head:{sha:bareGit(['rev-parse',branch]),ref:branch,repo:{full_name:repository}},base:{ref:'main'}};return{code:0,out:`https://github.com/${repository}/pull/1`,err:''};}
    assert(args.includes('PUT'));assert.equal(args.find(a=>a.startsWith('sha=')).slice(4),pr.head.sha);bareGit(['update-ref','refs/heads/main',pr.head.sha]);bareGit(['update-server-info']);pr={...pr,state:'closed',merged:true,merge_commit_sha:pr.head.sha};return{code:0,out:'{}',err:''};
   }
   return runCommand(bin,args,options);
  };
  const model=async(job,cwd)=>{
   modelCalls++;assert.equal(job.context.project.environment.database,'sqlite');
   if(modelCalls===1){
    let source=await readFile(join(cwd,'server.mjs'),'utf8');source="import {database} from './storage.mjs';\ndatabase.exec('CREATE TABLE IF NOT EXISTS counter(id INTEGER PRIMARY KEY,n INTEGER)');database.exec('INSERT OR IGNORE INTO counter VALUES(1,0)');\n"+source;
    source=source.replace("if(req.url==='/health')", "if(req.url==='/api/count'){if(req.method==='POST')database.exec('UPDATE counter SET n=n+1 WHERE id=1');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(database.prepare('SELECT n FROM counter WHERE id=1').get()));return;}if(req.url==='/health')");await writeFile(join(cwd,'server.mjs'),source);
    await writeFile(join(cwd,'public/index.html'),'<h1>Managed counter</h1><button>Save</button><output></output><script>async function load(){document.querySelector("output").textContent=(await(await fetch("/api/count")).json()).n}document.querySelector("button").onclick=async()=>{await fetch("/api/count",{method:"POST"});await load()};load()</script>');
   }else{assert.equal(job.context.history[0].outcome,'merged');const file=join(cwd,'public/index.html');await writeFile(file,(await readFile(file,'utf8')).replace('Managed counter','Continued counter'));}
   return{blocked:false,reply:'합성 개발 응답 '+modelCalls,summary:'카운터 구현',currentStatus:'수정 완료',nextAction:'화면 확인',followUps:[]};
  };
  const options={stateDir:directory,run,get,model,delay:async()=>{},log(){},previewEnabled:true,remotePreview:{origin:base,binary:network.binary},previewTools:{...preview,startMacPreview:opts=>preview.startMacPreview({...opts,bridge:async(...args)=>bridge=await preview.createPreviewBridge(...args)})}};
  const agent=page.getByRole('region',{name:'프로젝트 AI 작업실',exact:true});
  for(let turn=1;turn<=2;turn++){
   if(turn===2){await agent.getByLabel('AI에게 요청',{exact:true}).fill('제목을 Continued counter로 바꾸고 저장값은 유지');await agent.getByRole('button',{name:'요청 보내기',exact:true}).click();await expect.poll(async()=> (await snapshot()).data.projects.find(p=>p.id===project.id).automation.turns.at(-1).status).toBe('queued');}
   const work=(await runner.request('/api/automation/claim',scope)).job;assert.equal(work.kind,'work');assert.equal(work.mode,'change');assert.equal(work.projectId,project.id);
   containers.push('jarvis-preview-'+createHash('sha256').update(`personal:${project.id}:${work.id}`).digest('hex').slice(0,24));
   await executeProjectWork(runner,work,options);
   current=(await snapshot()).data.projects.find(p=>p.id===project.id);const result=current.automation.turns.at(-1).result;assert.equal(result?.outcome,'merged',JSON.stringify(current.automation.turns.at(-1)));assert(result.checks.length>0&&result.checks.every(c=>c.status==='passed'),JSON.stringify(result.checks));assert.equal(result.preview?.state,'ready',JSON.stringify(result));assert.equal(result.preview.dataPersistence,'project');
   await expect(agent).toContainText('합성 개발 응답 '+turn,{timeout:40000});await page.reload();
   const popup=context.waitForEvent('page');await page.getByRole('region',{name:'수정된 화면 확인',exact:true}).getByRole('link',{name:'이 PC에서 화면 열기 ↗',exact:true}).click();const app=await popup;await app.waitForURL(lifecycleRemote);
   await expect(app.getByRole('heading',{name:turn===1?'Managed counter':'Continued counter',exact:true})).toBeVisible();await expect(app.locator('output')).toHaveText(turn===1?'0':'1');
   if(turn===1){await app.getByRole('button',{name:'Save',exact:true}).click();await expect(app.locator('output')).toHaveText('1');await app.reload();await expect(app.locator('output')).toHaveText('1');}
   await app.close();
  }
  assert.equal(modelCalls,2);assert.equal(current.automation.turns.length,2);await page.screenshot({path:'test-results/project-lifecycle-autopilot.png',fullPage:true});
  recordCheck('automatic lifecycle: browser project+goal -> private repository bootstrap -> actual Git checkout -> synthetic model edits -> real Docker tests -> synthetic PR/check/merge -> signed HTTPS -> persisted SQLite write -> follow-up code change -> new container preserves data; no external resources/model calls');
 }catch(e){await page?.screenshot({path:'test-results/project-lifecycle-autopilot-failure.png',fullPage:true}).catch(()=>{});throw e;}finally{await context?.close();bridge?.close();for(const name of containers){await runCommand('docker',['rm','-f',name]).catch(()=>{});await runCommand('docker',['image','rm',name+':app']).catch(()=>{});}if(project){const group=createHash('sha256').update(`personal:${project.id}:example/${setupName({...project.setup,projectId:project.id,space:'personal',name:project.name})}`).digest('hex').slice(0,24);await runCommand('docker',['volume','rm','jarvis-data-'+group]).catch(()=>{});}if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(directory,{recursive:true,force:true});}
}
