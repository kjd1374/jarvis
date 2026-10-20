import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDevelopmentPreview, developmentStatus, developmentEnvironment, developmentSandbox, runDevelopmentTests } from '../public/jarvis-development.mjs';
import { runCommand } from '../public/jarvis-runner.mjs';
const group = 'personal:synthetic:example/fixture';
test('native app environment drops all inherited credentials and sandbox does not allow arbitrary network/home paths', () => {
  const env = developmentEnvironment('/private/release', 4567);
  assert(!env.OPENAI_API_KEY && !env.GH_TOKEN && !env.JARVIS_PREVIEW_CLI_TOKEN);
  assert.equal(env.HOME, '/private/release/home');
  const policy = developmentSandbox('/private/release', '/private/project-data', [4567,4568,4569], '/opt/runtime/bin/node');
  assert(policy.includes('(deny default)')); assert(policy.includes('localhost:4567'));
  assert(!policy.includes('(allow network*)') && !policy.includes('(subpath "/Users")') && !policy.includes('11434'));
});
test('unsupported hosts do not run untrusted native code', async () => {
  let ran = false;
  assert.equal(await startDevelopmentPreview({}, { platform: 'linux', launch: () => { ran = true; } }), null);
  assert.equal(ran, false);
});
test('macOS native lifecycle reuses a live server, preserves DATA_DIR across versions, stops/restarts and enforces isolation', { skip: process.platform !== 'darwin' }, async () => {
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
    await writeFile(profile, developmentSandbox(isolationRoot, join(isolationRoot,'data'), [], await realpath(process.execPath)));
    const probe = await runCommand('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, '-e', `const fs=require('node:fs');let blocked=false;try{fs.readFileSync(${JSON.stringify(secret)})}catch{blocked=true}if(!blocked)process.exit(11);const net=require('node:net');const c=net.connect(11434,'127.0.0.1');c.on('connect',()=>process.exit(12));c.on('error',()=>process.stdout.write('isolated'));setTimeout(()=>process.exit(13),2000).unref();`], { cwd: isolationRoot, env: developmentEnvironment(isolationRoot,0) });
    assert.equal(probe.code, 0, probe.err); assert.equal(probe.out,'isolated');
    await writeFile(join(cwd, 'fixture.test.mjs'), `import{test}from'node:test';import assert from'node:assert/strict';test('actual synthetic check',()=>assert.equal(2+2,4));`);
    const checks = await runDevelopmentTests({ ...options, identity:group, files:['server.mjs','fixture.test.mjs'] });
    assert.equal(checks[0].status, 'passed', JSON.stringify(checks)); assert.match(checks[0].detail, /tests 1|tests\s+1/);
  } finally { developmentStatus(group, 'stop'); await new Promise(resolve=>setTimeout(resolve,100)); await rm(dir,{recursive:true,force:true}); }
});

test('native AI bridge verifies once, reuses its worker and fences app inference by browser approval', { skip: process.platform !== 'darwin' }, async()=>{
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
test('native npm releases and separate checks reuse the same lock cache without install hooks', {skip:process.platform!=='darwin'},async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'jarvis-native-npm-'))),cwd=join(dir,'source'),stateDir=join(dir,'state'),group='personal:npm:example/fixture';await mkdir(cwd);await mkdir(stateDir);let installs=0;
 const pkg={name:'synthetic-native',version:'1.0.0',private:true,scripts:{start:'node server.mjs',build:'node -e "process.stdout.write(\'built\')"',test:'node --test fixture.test.mjs',preinstall:'node -e "process.exit(91)"'}};
 await writeFile(join(cwd,'package.json'),JSON.stringify(pkg));await writeFile(join(cwd,'package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,packages:{'':{name:pkg.name,version:pkg.version,hasInstallScript:true}}}));
 await writeFile(join(cwd,'server.mjs'),`import http from'node:http';http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Npm fixture</h1>')}).listen(Number(process.env.PORT),'127.0.0.1');`);
 await writeFile(join(cwd,'fixture.test.mjs'),`import{test}from'node:test';import assert from'node:assert/strict';test('native cached fixture',()=>assert.equal(3*3,9))`);
 const options={cwd,files:['server.mjs','package.json','package-lock.json','fixture.test.mjs'],sha:'d'.repeat(40),stateDir,group,run:async(bin,args,opts)=>{if(bin==='npm'&&args[0]==='ci')installs++;return runCommand(bin,args,opts);}};
 try{
  const first=await startDevelopmentPreview(options);assert.equal(first.state,'ready',JSON.stringify(first)+' '+developmentStatus(group).detail);assert.equal(installs,1);
  const changed=await startDevelopmentPreview({...options,sha:'e'.repeat(40)});assert.equal(changed.state,'ready',JSON.stringify(changed)+' '+developmentStatus(group).detail);assert.equal(installs,1);
  const checks=await runDevelopmentTests({...options,identity:group+':checks'});assert.equal(checks[0].status,'passed',JSON.stringify(checks));assert.equal(installs,1);
 }finally{developmentStatus(group,'stop');await new Promise(resolve=>setTimeout(resolve,100));await rm(dir,{recursive:true,force:true});}
});
