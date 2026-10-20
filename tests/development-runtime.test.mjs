import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { startDevelopmentPreview, developmentStatus, developmentEnvironment, developmentSandbox, developmentRuntimeLibraries, runDevelopmentTests } from '../public/jarvis-development.mjs';
import { runCommand } from '../public/jarvis-runner.mjs';
const group = 'personal:synthetic:example/fixture';
test('native app environment drops all inherited credentials and sandbox does not allow arbitrary network/home paths', () => {
  const env = developmentEnvironment('/private/release', 4567);
  assert(!env.OPENAI_API_KEY && !env.GH_TOKEN && !env.JARVIS_PREVIEW_CLI_TOKEN);
  assert.equal(env.HOME, '/private/release/home');
  assert.equal(env.OPENSSL_CONF, '/dev/null');
  const policy = developmentSandbox('/private/release', '/private/project-data', [4567,4568,4569], '/opt/runtime/bin/node');
  assert(policy.includes('(deny default)')); assert(policy.includes('(allow network-bind (local ip "localhost:*"))') && policy.includes('(remote tcp "localhost:4567")'));
  assert(!policy.includes('(allow network*)') && !policy.includes('(subpath "/Users")') && !policy.includes('11434'));
});
test('unsupported hosts do not run untrusted native code', async () => {
  let ran = false;
  assert.equal(await startDevelopmentPreview({}, { platform: 'linux', launch: () => { ran = true; } }), null);
  assert.equal(ran, false);
});
test('runtime library discovery canonicalizes loaded Mach-O files without granting their containing directory', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-libraries-'));
 try{
  const library=join(dir,'lib synthetic.dylib'),alias=join(dir,'alias.dylib'),privateFile=join(dir,'private.txt');
  await writeFile(library,Buffer.from([0xcf,0xfa,0xed,0xfe,0,0,0,0]));await writeFile(privateFile,'PRIVATE_DATA');
  const {symlink}=await import('node:fs/promises');await symlink(library,alias);
  const paths=await developmentRuntimeLibraries([alias,library,privateFile,'relative.dylib',join(dir,'missing.dylib')]);
  assert.deepEqual(paths,[await realpath(library)]);
  const policy=developmentSandbox('/private/release','/private/project-data',[],process.execPath,paths);
  assert(policy.includes(`(literal ${JSON.stringify(await realpath(library))})`));assert(!policy.includes(`(subpath ${JSON.stringify(dir)})`));assert(!policy.includes('private.txt'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('failed sandbox probe preserves its exit status and scoped logs without starting app code',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'jarvis-probe-'))),cwd=join(dir,'source'),stateDir=join(dir,'state'),group='personal:probe:example/fixture';await mkdir(cwd);await mkdir(stateDir);await writeFile(join(cwd,'index.html'),'<h1>Synthetic</h1>');let launched=false;
 try{
  for(const [probe,status]of [[{code:126},126],[{code:null,terminationSignal:'SIGABRT'},134]]){
   const result=await startDevelopmentPreview({cwd,files:['index.html'],sha:'a'.repeat(40),stateDir,group,run:async()=>({...probe,out:'',err:'dyld: Library not loaded: /synthetic/runtime/libfixture.dylib'})},{platform:'darwin',launch:()=>{launched=true;throw Error('untrusted app must not run');}});
   assert.equal(result.state,'failed');assert.equal(result.diagnostic.code,'development_sandbox_unavailable');assert.equal(result.diagnostic.exitCode,status);assert.equal(launched,false);assert(!JSON.stringify(result).includes('/synthetic/runtime'));
  }
  assert.match(developmentStatus(group).detail,/Library not loaded/);assert(!developmentStatus('company:probe:example/fixture').detail.includes('Library not loaded'));
 }finally{developmentStatus(group,'stop');await rm(dir,{recursive:true,force:true});}
});
test('macOS runtime loads an external dylib with an exact read grant while sibling files stay private',{skip:process.platform!=='darwin',timeout:90_000},async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),"jarvis-external-lib-'"))),root=join(dir,'release'),bin=join(dir,'runtime','bin'),deps=join(dir,'dependencies'),data=join(root,'data');for(const path of[root,bin,deps,data])await mkdir(path,{recursive:true});
 const library=join(deps,'libfixture.dylib'),secret=join(deps,'private-original.txt'),executable=join(bin,'fixture'),profile=join(root,'sandbox.sb');
 try{
  await writeFile(secret,'PRIVATE_ORIGINAL');await writeFile(join(root,'library.c'),'int fixture(void){return 42;}');await writeFile(join(root,'main.c'),'#include <stdio.h>\nextern int fixture(void);int main(int argc,char**argv){if(argc>1){FILE*f=fopen(argv[1],"r");if(f){fclose(f);return 88;}}printf("runtime-library-%d",fixture());return 0;}');
  for(const args of [['-dynamiclib',join(root,'library.c'),'-install_name',library,'-o',library],[join(root,'main.c'),library,'-o',executable]]){const r=await runCommand('/usr/bin/clang',args,{cwd:root});assert.equal(r.code,0,r.err);}
  await writeFile(profile,developmentSandbox(root,data,[],executable));
  const denied=await runCommand('/usr/bin/sandbox-exec',['-f',profile,executable,secret],{cwd:root,env:developmentEnvironment(root,0)});assert.notEqual(denied.code,0,'baseline must reproduce a loader failure outside the runtime directory');assert.match(denied.err,/Library not loaded/);assert(denied.err.includes(library));
  await writeFile(profile,developmentSandbox(root,data,[],executable,await developmentRuntimeLibraries([library])));
  const allowed=await runCommand('/usr/bin/sandbox-exec',['-f',profile,executable,secret],{cwd:root,env:developmentEnvironment(root,0)});assert.equal(allowed.code,0,allowed.err);assert.equal(allowed.out,'runtime-library-42');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('macOS Homebrew-style opt aliases load with discovered runtime grants while adjacent files stay private',{skip:process.platform!=='darwin',timeout:90_000},async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),"jarvis-homebrew-'"))),root=join(dir,'release'),bin=join(dir,'Cellar','node','26','bin'),deps=join(dir,'Cellar','llhttp','9.4','lib'),opt=join(dir,'opt'),data=join(root,'data');
 for(const path of[root,bin,deps,opt,data])await mkdir(path,{recursive:true});
 const library=join(deps,'libfixture.dylib'),alias=join(opt,'llhttp','lib','libfixture.dylib'),secret=join(deps,'private-original.txt'),executable=join(bin,'fixture'),profile=join(root,'sandbox.sb');
 try{
  await symlink(join(deps,'..'),join(opt,'llhttp'));await writeFile(secret,'PRIVATE_ORIGINAL');
  await writeFile(join(root,'library.c'),'int fixture(void){return 42;}');
  await writeFile(join(root,'main.c'),'#include <stdio.h>\nextern int fixture(void);int main(int argc,char**argv){if(argc>1){FILE*f=fopen(argv[1],"r");if(f){fclose(f);return 88;}}printf("homebrew-runtime-%d",fixture());return 0;}');
  for(const args of [['-dynamiclib',join(root,'library.c'),'-install_name',alias,'-o',library],[join(root,'main.c'),alias,'-o',executable]]){const r=await runCommand('/usr/bin/clang',args,{cwd:root});assert.equal(r.code,0,r.err);}
  await writeFile(profile,developmentSandbox(root,data,[],executable));
  const denied=await runCommand('/usr/bin/sandbox-exec',['-f',profile,executable,secret],{cwd:root,env:developmentEnvironment(root,0)});assert.notEqual(denied.code,0);assert.match(denied.err,/Library not loaded/);assert(denied.err.includes(alias));
  await writeFile(profile,developmentSandbox(root,data,[],executable,await developmentRuntimeLibraries([alias])));
  const allowed=await runCommand('/usr/bin/sandbox-exec',['-f',profile,executable,secret],{cwd:root,env:developmentEnvironment(root,0)});assert.equal(allowed.code,0,allowed.err);assert.equal(allowed.out,'homebrew-runtime-42');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('macOS native lifecycle reuses a live server, preserves DATA_DIR across versions, stops/restarts and enforces isolation', { skip: process.platform !== 'darwin', timeout:90_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'jarvis-native-test-'))), cwd = join(dir, 'source'), stateDir = join(dir, 'state'), secret = join(dir, 'other-project');
  await mkdir(cwd); await mkdir(stateDir); await writeFile(secret, 'OTHER_PROJECT_PRIVATE');
  const source = `import http from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';
  const root=process.env.DATA_DIR;await mkdir(root,{recursive:true});let count=Number(await readFile(root+'/counter','utf8').catch(()=>0));
  http.createServer(async(req,res)=>{if(req.url==='/save'){await writeFile(root+'/counter',String(++count));res.end(String(count));return;}
  if(req.url==='/isolation'){let denied=false;try{await readFile(${JSON.stringify(secret)});}catch{denied=true;}res.end(JSON.stringify({denied,home:process.env.HOME,credential:!!process.env.GH_TOKEN}));return;}
  res.setHeader('Content-Type','text/html');res.end('<h1>Native fixture</h1>');}).listen(Number(process.env.PORT),'127.0.0.1');`;
  await writeFile(join(cwd, 'server.mjs'), source);
  const options = { cwd, files: ['server.mjs'], sha: 'a'.repeat(40), stateDir, group, persistent: true, run: async (bin,args,options) => { const result=await runCommand(bin,args,options); if(result.code!==0) console.error("synthetic native check:",bin,result.code,result.terminationSignal,result.err.slice(-4000)); return result; } };
  try {
    const first = await startDevelopmentPreview(options);
    if(first.state!=='ready')console.error('synthetic application log',developmentStatus(group).detail);
    assert.equal(first.state, 'ready', JSON.stringify(first)); assert.equal(first.execution, 'native');
    assert.equal(await (await fetch(first.url + 'save')).text(), '1');
    assert.deepEqual(await (await fetch(first.url + 'isolation')).json(), { denied: true, home: (await (await fetch(first.url+'isolation')).json()).home, credential: false });
    const second = await startDevelopmentPreview(options);
    assert.equal(second.url, first.url); assert.equal(second.reused, true);
    assert.equal(await (await fetch(second.url + 'save')).text(), '2');
    const changed = await startDevelopmentPreview({ ...options, sha: 'b'.repeat(40) });
    assert.equal(changed.state, 'ready', JSON.stringify(changed)); assert.notEqual(changed.url, first.url);
    assert.equal(await (await fetch(changed.url + 'save')).text(), '3');
    assert.equal(developmentStatus(group).running, true); assert.equal(developmentStatus('company:other:example/fixture').running, false);
    developmentStatus(group, 'stop'); assert.equal(developmentStatus(group).running, false);
    const restarted = await startDevelopmentPreview(options); assert.equal(restarted.state, 'ready', JSON.stringify(restarted));
    assert.equal(await (await fetch(restarted.url + 'save')).text(), '4');
    // A real child under the production profile cannot read a sibling project or connect to an arbitrary host port.
    const isolationRoot = join(stateDir, 'isolation'); await mkdir(isolationRoot); const profile = join(isolationRoot, 'sandbox.sb');
    await writeFile(profile, developmentSandbox(isolationRoot, join(isolationRoot,'data'), [], await realpath(process.execPath), await developmentRuntimeLibraries()));
    const probe = await runCommand('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, '-e', `const fs=require('node:fs');let blocked=false;try{fs.readFileSync(${JSON.stringify(secret)})}catch{blocked=true}if(!blocked)process.exit(11);const net=require('node:net');const c=net.connect(11434,'127.0.0.1');c.on('connect',()=>process.exit(12));c.on('error',()=>process.stdout.write('isolated'));setTimeout(()=>process.exit(13),2000).unref();`], { cwd: isolationRoot, env: developmentEnvironment(isolationRoot,0) });
    assert.equal(probe.code, 0, probe.err); assert.equal(probe.out,'isolated');
    await writeFile(join(cwd, 'fixture.test.mjs'), `import{test}from'node:test';import assert from'node:assert/strict';test('actual synthetic check',()=>assert.equal(2+2,4));`);
    const checks = await runDevelopmentTests({ ...options, identity:group, files:['server.mjs','fixture.test.mjs'] });
    assert.equal(checks[0].status, 'passed', JSON.stringify(checks)); assert.match(checks[0].detail, /tests 1|tests\s+1/);
  } finally { developmentStatus(group, 'stop'); await new Promise(resolve=>setTimeout(resolve,100)); await rm(dir,{recursive:true,force:true}); }
});

test('native AI bridge verifies once, reuses its worker and fences app inference by browser approval', { skip: process.platform !== 'darwin', timeout:90_000 }, async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),"jarvis-native-ai-'"))),cwd=join(dir,'source'),stateDir=join(dir,'state'),group='personal:ai:example/fixture';await mkdir(cwd);await mkdir(stateDir);
 await writeFile(join(cwd,'server.mjs'),`import http from'node:http';import{readFile}from'node:fs/promises';const config=JSON.parse(await readFile(new URL('config.json',import.meta.url)));http.createServer(async(req,res)=>{if(req.url==='/translate'){const r=await fetch(config.profiles.jarvis.baseUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'안녕하세요'}]})});res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return;}res.setHeader('Content-Type','text/html');res.end('<h1>AI fixture</h1>')}).listen(Number(process.env.PORT),'127.0.0.1');`);
 await writeFile(join(cwd,'config.example.json'),JSON.stringify({profiles:{},teacher:{}}));let calls=0;
 const options={cwd,files:['server.mjs','config.example.json'],sha:'c'.repeat(40),stateDir,group,run:runCommand,aiProvider:'ollama',cliInference:async()=>{calls++;return'Xin chào'},authorizeCliPreparation:async()=>true};
 try{
  const first=await startDevelopmentPreview(options);assert.equal(first.state,'ready',JSON.stringify(first)+' '+developmentStatus(group).detail);assert.equal(first.ai.provider,'ollama');assert.equal(calls,1);
  const same=await startDevelopmentPreview(options);assert.equal(same.url,first.url);assert.equal(same.reused,true);assert.equal(calls,1);
  assert.equal((await fetch(first.url+'translate')).status,503);assert.equal(calls,1);
  const {attachPreviewCliAuthorization}=await import('../public/jarvis-preview.mjs');assert(attachPreviewCliAuthorization(first.url,async()=>true));assert.equal((await(await fetch(first.url+'translate')).json()).choices[0].message.content,'Xin chào');assert.equal(calls,2);
  assert(attachPreviewCliAuthorization(first.url,async()=>false));assert.equal((await fetch(first.url+'translate')).status,503);assert.equal(calls,2);
 }finally{developmentStatus(group,'stop');await new Promise(resolve=>setTimeout(resolve,100));await rm(dir,{recursive:true,force:true});}
});
test('native npm releases and separate checks reuse the same lock cache without install hooks', {skip:process.platform!=='darwin',timeout:90_000},async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'jarvis-native-npm-'))),cwd=join(dir,'source'),stateDir=join(dir,'state'),group='personal:npm:example/fixture';await mkdir(cwd);await mkdir(stateDir);let installs=0, testPolicy='';
 const pkg={name:'synthetic-native',version:'1.0.0',private:true,scripts:{start:'node server.mjs',build:'node -e "process.stdout.write(\'built\')"',test:'node --test fixture.test.mjs',preinstall:'node -e "process.exit(91)"'}};
 await writeFile(join(cwd,'package.json'),JSON.stringify(pkg));await writeFile(join(cwd,'package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,packages:{'':{name:pkg.name,version:pkg.version,hasInstallScript:true}}}));
 await writeFile(join(cwd,'server.mjs'),`import http from'node:http';http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Npm fixture</h1>')}).listen(Number(process.env.PORT),'127.0.0.1');`);
 await writeFile(join(cwd,'fixture.test.mjs'),`import{test}from'node:test';import assert from'node:assert/strict';import http from'node:http';test('native cached HTTP behavior',async()=>{const server=http.createServer((req,res)=>res.end('fixture response'));await new Promise(r=>server.listen(0,'127.0.0.1',r));try{assert.equal(await(await fetch('http://127.0.0.1:'+server.address().port)).text(),'fixture response')}finally{await new Promise(r=>server.close(r))}})`);
 const options={cwd,files:['server.mjs','package.json','package-lock.json','fixture.test.mjs'],sha:'d'.repeat(40),stateDir,group,run:async(bin,args,opts)=>{if(bin==='npm'&&args[0]==='ci')installs++;if(bin==='/usr/bin/sandbox-exec'){testPolicy=await readFile(args[1],'utf8');}const result=await runCommand(bin,args,opts);if(bin==='/usr/bin/sandbox-exec'&&result.code!==0){const numeric=args[1]+'.numeric';await writeFile(numeric,testPolicy.replaceAll('localhost:','127.0.0.1:'));for(let n=0;n<4;n++){for(const mode of ['localhost','numeric']){const probe=await runCommand(bin,mode==='numeric'?[args[0],numeric,...args.slice(2)]:args,opts);console.error('synthetic seatbelt address comparison',JSON.stringify({mode,attempt:n,code:probe.code,detail:(probe.out+probe.err).slice(-1800)}));}}}return result;}};
 try{
  const first=await startDevelopmentPreview(options);assert.equal(first.state,'ready',JSON.stringify(first)+' '+developmentStatus(group).detail);assert.equal(installs,1);
  const persistent=await startDevelopmentPreview({...options,persistent:true});assert.equal(persistent.state,'ready',JSON.stringify(persistent)+' '+developmentStatus(group).detail);assert.equal(persistent.dataPersistence,'project');assert.notEqual(persistent.url,first.url);assert.equal(installs,1);
  const changed=await startDevelopmentPreview({...options,persistent:true,sha:'e'.repeat(40)});assert.equal(changed.state,'ready',JSON.stringify(changed)+' '+developmentStatus(group).detail);assert.equal(installs,1);
  for(let attempt=0;attempt<6;attempt++){const checks=await runDevelopmentTests({...options,identity:group+':checks'});assert.equal(checks[0].status,'passed',JSON.stringify(checks)+' synthetic policy '+testPolicy);assert.equal(installs,1);}
 }finally{developmentStatus(group,'stop');await new Promise(resolve=>setTimeout(resolve,100));await rm(dir,{recursive:true,force:true});}
});

test('native startup retries one observed port collision without rerunning inference or discarding data', {skip:process.platform!=='darwin',timeout:90_000},async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'jarvis-native-bind-'))),cwd=join(dir,'source'),stateDir=join(dir,'state'),group='personal:bind:example/fixture';await mkdir(cwd);await mkdir(stateDir);let starts=0;const diagnostic=[];
 await writeFile(join(cwd,'server.mjs'),`import http from'node:http';http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Bind fixture</h1>')}).listen(Number(process.env.PORT),'127.0.0.1');`);
 try{const result=await startDevelopmentPreview({cwd,files:['server.mjs'],sha:'b'.repeat(40),stateDir,group,persistent:true,run:runCommand},{launch:(bin,args,opts)=>{starts++;const profile=readFileSync(args[1],'utf8'),source=readFileSync(args[3],'utf8');diagnostic.push({attempt:starts,port:opts.env.PORT,allowed:[...profile.matchAll(/localhost:(\d+)/g)].map(m=>m[1]),appPort:source.match(/PORT:'(\d+)'/)?.[1],proxyPort:source.match(/\.listen\((\d+)/)?.[1]});return starts===1?spawn(bin,[...args.slice(0,3),'-e',"console.error('EADDRINUSE');process.exit(1)"],opts):spawn(bin,args,opts);}});if(result.state!=='ready')console.error('synthetic native bind diagnostic',JSON.stringify({result,diagnostic,detail:developmentStatus(group).detail}));assert.equal(result.state,'ready',JSON.stringify(result)+' '+developmentStatus(group).detail);assert.equal(starts,2);assert.equal(result.dataPersistence,'project');}
 finally{developmentStatus(group,'stop');await new Promise(resolve=>setTimeout(resolve,100));await rm(dir,{recursive:true,force:true});}
});

test('macOS repeated app startups bind only their assigned TCP ports', {skip:process.platform!=='darwin',timeout:90_000},async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'jarvis-repeat-start-'))),cwd=join(dir,'source'),stateDir=join(dir,'state'),group='personal:repeated:example/fixture';await mkdir(cwd);await mkdir(stateDir);await writeFile(join(cwd,'index.html'),'<h1>Repeated native fixture</h1>');
 try{
  for(let attempt=0;attempt<12;attempt++){
   const result=await startDevelopmentPreview({cwd,files:['index.html'],sha:attempt.toString(16).padStart(40,'0'),stateDir,group,persistent:true,run:runCommand});
   assert.equal(result.state,'ready',`attempt ${attempt}: ${JSON.stringify(result)} ${developmentStatus(group).detail}`);
   assert.match(await(await fetch(result.url)).text(),/Repeated native fixture/);
  }
 }finally{developmentStatus(group,'stop');await new Promise(resolve=>setTimeout(resolve,100));await rm(dir,{recursive:true,force:true});}
});

test('generated runtime keeps real paths and overlapping port numbers intact',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'jarvis-3000-template-'))),cwd=join(dir,'source'),stateDir=join(dir,'state');await mkdir(cwd);await mkdir(stateDir);await writeFile(join(cwd,'index.html'),'<h1>Template fixture</h1>');let captured;
 try{
  const ports=[30011,30012,30013];
  await startDevelopmentPreview({cwd,files:['index.html'],sha:'a'.repeat(40),stateDir,group:'personal:template:example/fixture',run:async()=>({code:0,out:'sandbox-ready',err:''})},{platform:'darwin',allocatePort:async()=>ports.shift(),launch:(_bin,args,opts)=>{captured={source:readFileSync(args[3],'utf8'),app:opts.cwd};throw Error('synthetic_stop_before_launch');}});
  assert(captured);assert(captured.source.includes(JSON.stringify(captured.app)),'path digits must remain unchanged');assert(captured.source.includes('127.0.0.1:30011'),'app port must not be replaced a second time');assert(captured.source.includes('.listen(30012,'),'proxy port must match its sandbox grant');
 }finally{await rm(dir,{recursive:true,force:true});}
});
