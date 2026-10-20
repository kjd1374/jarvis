import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDevelopmentPreview, developmentStatus } from '../public/jarvis-development.mjs';
import { attachPreviewCliAuthorization } from '../public/jarvis-preview.mjs';
import { runCommand } from '../public/jarvis-runner.mjs';

// Synthetic contract reproduces the reported app's startup config/warmup and
// streaming completion transport. No private source, learner data or model access.
test('interpreter startup contract distinguishes unconnected local profile from approved bridge inference', { skip: process.platform !== 'darwin', timeout: 90_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'jarvis-interpreter-')));
  const cwd = join(dir, 'source'), stateDir = join(dir, 'state'), group = 'personal:interpreter:example/fixture';
  await mkdir(cwd); await mkdir(stateDir); await mkdir(join(cwd, 'public'));
  const files = ['server.mjs', 'config.example.json', 'public/index.html'];
  await writeFile(join(cwd, 'server.mjs'), `import http from 'node:http';import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('config.json','utf8').catch(()=>readFile('config.example.json','utf8')));
http.createServer(async(req,res)=>{
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};
  if(req.url==='/api/config')return json(config);
  if(req.url==='/api/warmup'&&config.profiles[config.active].warmup===false)return json({skipped:true});
  if(req.url==='/api/warmup'||req.url==='/api/interpret'){
    const profile=config.profiles[config.active];let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw||'{}');
    try{
      const upstream=await fetch(profile.baseUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:profile.model,messages:[{role:'user',content:body.text||'시작'}],stream:true,max_tokens:req.url==='/api/warmup'?1:256})});
      if(!upstream.ok){const error=await upstream.json();return json({error:error.error.message});}
      if(req.url==='/api/warmup'){await upstream.text();return json({ok:true});}
      res.writeHead(200,{'Content-Type':'text/event-stream'});for await(const part of upstream.body)res.write(part);res.end();
    }catch(error){json({ok:false,message:'연결 실패: '+error.message+' ('+error.cause?.code+')'});}return;
  }
  res.setHeader('Content-Type','text/html');res.end('<h1>Interpreter contract</h1>');
}).listen(Number(process.env.PORT),'127.0.0.1');`);
  await writeFile(join(cwd, 'public/index.html'), '<h1>Synthetic interpreter page</h1>');
  await writeFile(join(cwd, 'config.example.json'), JSON.stringify({ active: 'local', profiles: { local: {
    label: '로컬 젬마', baseUrl: 'http://localhost:11434/v1', model: 'translategemma:4b', apiKey: '', extraBody: {},
  } }, teacher: { provider: 'profile', profile: 'local' } }));
  let calls = 0;
  const options = { cwd, stateDir, files, group, sha: 'a'.repeat(40), run: runCommand };
  const post = async (url, path, body) => (await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const disconnected = await startDevelopmentPreview(options);
    assert.equal(disconnected.state, 'ready', JSON.stringify(disconnected) + developmentStatus(group).detail);
    // Reproduce the reported startup banner: app warmup hits host Ollama directly.
    const warmup = await post(disconnected.url, 'api/warmup', {});
    assert.equal(warmup.ok, false); assert.match(warmup.message, /fetch failed \(EPERM\)/);
    const connected = await startDevelopmentPreview({ ...options, aiProvider: 'ollama', authorizeCliPreparation: async () => true,
      cliInference: async body => { calls++; assert(body.messages.every(m => !m.content.includes('PRIVATE'))); return 'Xin chào'; } });
    assert.equal(connected.state, 'ready', JSON.stringify(connected) + developmentStatus(group).detail);
    assert.equal(connected.ai.provider, 'ollama'); assert.equal(calls, 1);
    const config = await (await fetch(connected.url + 'api/config')).json();
    assert.equal(config.active, 'jarvis'); assert.deepEqual(Object.keys(config.profiles), ['jarvis']);
    assert(!JSON.stringify(config).includes('11434'));
    assert.deepEqual(await post(connected.url, 'api/warmup', { profile: config.active }), { skipped: true });
    const request = { profile: config.active, text: '안녕하세요', sourceLang: 'ko', stream: true };
    assert(attachPreviewCliAuthorization(connected.url, async () => true));
    const response = await fetch(connected.url + 'api/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const stream = await response.text();
    assert.equal(response.status, 200); assert.match(stream, /Xin chào/); assert.match(stream, /data: \[DONE\]/); assert.equal(calls, 2);
    assert(attachPreviewCliAuthorization(connected.url, async () => false));
    const denied = await post(connected.url, 'api/interpret', { ...request, stream: false });
    assert.match(denied.error, /승인된 Jarvis/); assert.equal(calls, 2);
  } finally { developmentStatus(group, 'stop'); await new Promise(r => setTimeout(r, 100)); await rm(dir, { recursive: true, force: true }); }
});
