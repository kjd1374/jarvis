import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
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
  assert(policy.includes('(deny default)')); assert(policy.includes('127.0.0.1:4567'));
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
  const options = { cwd, files: ['server.mjs'], sha: 'a'.repeat(40), stateDir, group, persistent: true, run: async (bin,args,options) => { const result=await runCommand(bin,args,options); if(result.code!==0) console.error("synthetic native check:",bin,result.code,result.err.slice(-4000)); return result; } };
  try {
    const first = await startDevelopmentPreview(options);
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
  } finally { developmentStatus(group, 'stop'); await new Promise(resolve=>setTimeout(resolve,1700)); await rm(dir,{recursive:true,force:true}); }
});
