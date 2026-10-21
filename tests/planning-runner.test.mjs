import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePlanning, answerPlanningWithCodex, validatePlanningAnswer, RunnerError } from '../public/jarvis-runner.mjs';
const job = { kind:'planning', id:'11111111-1111-4111-8111-111111111111', space:'personal', projectId:'idea', leaseToken:'22222222-2222-4222-8222-222222222222',attempt:1,request:'기획안을 정리',name:'합성 기획',description:'개인 도구',document:'기존 결정',history:[] };
const answer={reply:'범위를 정리했습니다.',document:'# 합성 기획\n가정 확인 필요'};
test('planning uses direct schema output with tool-disabled subscription execution and no GitHub or paid API',async()=>{
 const calls=[];
 const run=async(bin,args,options)=>{calls.push({bin,args});assert.equal(bin,'codex');
  if(args[0]==='login'){assert.equal(options.timeout,15000);return{code:0,out:'Logged in using ChatGPT',err:''};}
  if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
  for(const value of ['shell_tool','unified_exec','multi_agent','multi_agent_v2','read-only','web_search="disabled"','approval_policy="never"'])assert(args.includes(value));assert(options.input.includes('확인되지 않은'));assert(options.input.includes(job.document));assert(options.input.includes('1500~3000'));
  const schema=JSON.parse(await readFile(args[args.indexOf('--output-schema')+1],'utf8'));assert.deepEqual(schema.required,['reply','document']);assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.content,undefined);assert.equal(options.env.OPENAI_API_KEY,undefined);assert.equal(options.timeout,300000);
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(answer));return{code:0,out:'',err:''};
 };
 assert.deepEqual(await answerPlanningWithCodex(job,{run,env:{PATH:process.env.PATH,OPENAI_API_KEY:'synthetic-excluded',GH_TOKEN:'synthetic-excluded'}}),answer);assert.equal(calls.length,3);
});
test('planning timeout codes distinguish login, feature check and generation without exposing CLI stderr',async()=>{
 for(const [stage,expected]of[['login','cli_login_timeout'],['check','cli_check_timeout'],['generation','cli_timeout']]){
  let executions=0;
  const run=async(_bin,args,options)=>{
   const phase=args[0]==='login'?'login':args.includes('--help')?'check':'generation';
   if(phase==='generation')executions++;
   if(phase===stage)throw new RunnerError('command_timeout');
   assert.equal(options.timeout,15000);
   return{code:0,out:phase==='login'?'ChatGPT':'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
  };
  await assert.rejects(answerPlanningWithCodex(job,{run}),error=>error.code===expected);
  assert.equal(executions,stage==='generation'?1:0);
 }
 await assert.rejects(answerPlanningWithCodex(job,{run:async()=>({code:0,out:'API key',err:''})}),error=>error.code==='cli_login_required');
 const run=async(_bin,args)=>args[0]==='login'?{code:0,out:'ChatGPT',err:''}:args.includes('--help')?{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''}:{code:1,out:'',err:'Usage limit reached. PRIVATE_DIAGNOSTIC'};
 await assert.rejects(answerPlanningWithCodex(job,{run}),error=>error.code==='cli_limit'&&!JSON.stringify(error).includes('PRIVATE_DIAGNOSTIC'));
});
test('direct planning output preserves a valid full document beyond the preview wrapper total-string limit',async()=>{
 const full={reply:'설명'.repeat(1000),document:'기존 결정 보존\n'+'가'.repeat(15000)};
 const run=async(_bin,args)=>{
  if(args[0]==='login')return{code:0,out:'ChatGPT',err:''};
  if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(full));return{code:0,out:'',err:''};
 };
 assert(JSON.stringify(full).length>16000);assert.deepEqual(await answerPlanningWithCodex({...job,document:full.document},{run}),full);
});
for(const cancelled of [false,true])test(cancelled?'cancellation during extended planning aborts the CLI and fences publication':'planning beyond the former two-minute limit renews its lease and publishes once',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const dir=await mkdtemp(join(tmpdir(),'planning-duration-')),reports=[];let heartbeats=0,calls=0,started;
 const generationStarted=new Promise(resolve=>{started=resolve;});
 try{
  const run=async(_bin,args,options)=>{
   if(args[0]==='login')return{code:0,out:'ChatGPT',err:''};
   if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
   calls++;assert(options.timeout>120000&&options.timeout<=300000);
   await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(answer));
   return new Promise((resolve,reject)=>{
    const stop=()=>{clearTimeout(done);clearTimeout(deadline);reject(new RunnerError('command_unavailable'));};
    const done=setTimeout(()=>{clearTimeout(deadline);options.signal.removeEventListener('abort',stop);resolve({code:0,out:'',err:''});},130000);
    const deadline=setTimeout(()=>{clearTimeout(done);options.signal.removeEventListener('abort',stop);reject(new RunnerError('command_timeout'));},options.timeout);
    options.signal.addEventListener('abort',stop,{once:true});started();
   });
  };
  const execution=executePlanning({request:async(_path,body)=>{
   reports.push(body);if(body.phase==='heartbeat'&&++heartbeats===2&&cancelled)throw new RunnerError('stale_job');
  }},job,{stateDir:dir,model:(job,options)=>answerPlanningWithCodex(job,{...options,run}),log(){}});
  await generationStarted;
  t.mock.timers.tick(cancelled?20000:120001);
  assert(!reports.some(body=>body.phase==='result'));
  if(!cancelled)t.mock.timers.tick(9999);
  await execution;
  assert.equal(calls,1);assert.equal(reports.filter(body=>body.phase==='result').length,cancelled?0:1);
  assert(!reports.some(body=>body.phase==='error'));assert(heartbeats>=(cancelled?2:7));assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('planning result delivery retries use one model invocation and clear the private cache only after acknowledgement',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'planning-test-'));let count=0,reports=0;
 try{await executePlanning({request:async(path,b)=>{assert.equal(path,'/api/automation/planning');assert.equal(b.projectId,'idea');if(b.phase==='result'){reports++;if(reports===1)throw new Error('lost acknowledgement');}}},job,{stateDir:dir,model:async()=>{count++;return answer;},delay:async()=>{},log(){}});assert.equal(count,1);assert.equal(reports,2);assert.deepEqual(await readdir(dir),[]);}finally{await rm(dir,{recursive:true,force:true});}
});
test('planning cancellation fences publication and invalid answers do not replace the plan',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'planning-test-'));let model=0;
 try{
  await executePlanning({request:async()=>{throw new RunnerError('stale_job');}},job,{stateDir:dir,model:async()=>{model++;return answer;},log(){}});assert.equal(model,0);
  const messages=[];await executePlanning({request:async(_,b)=>{messages.push(b);}},job,{stateDir:dir,model:async()=>({reply:'',document:'bad'}),log(){}});
  assert.equal(messages.at(-1).phase,'error');assert(!messages.some(b=>b.phase==='result'));assert.throws(()=>validatePlanningAnswer({reply:'ok',document:' '}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('restarting a result-pending attempt reads its cached answer without a second subscription call',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'planning-test-'));let models=0;
 try{
  await executePlanning({request:async(_,b)=>{if(b.phase==='result')throw new Error('network');}},job,{stateDir:dir,model:async()=>{models++;return answer;},delay:async()=>{},log(){}});
  assert.equal((await readdir(dir)).length,1);assert.deepEqual(JSON.parse(await readFile(join(dir,(await readdir(dir))[0]),'utf8')),answer);
  await executePlanning({request:async()=>{}},job,{stateDir:dir,model:async()=>{models++;return answer;},log(){}});assert.equal(models,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('planning preserves timeout and invalid-answer codes through the real completion and error-report path',async()=>{
 for(const [mode,expected] of [['timeout','cli_timeout'],['completion','invalid_planning_answer'],['plan','invalid_planning_answer']]){
  const dir=await mkdtemp(join(tmpdir(),'planning-failure-')),reports=[],logs=[];let executions=0;
  try{
   const run=async(_bin,args,options)=>{
    if(args[0]==='login')return{code:0,out:'Logged in using ChatGPT',err:''};
    if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
    executions++;assert.equal(options.timeout,300000);
    if(mode==='timeout')throw new RunnerError('command_timeout');
    await writeFile(args[args.indexOf('--output-last-message')+1],mode==='completion'?'unfinished JSON':JSON.stringify({reply:'synthetic reply',document:''}));return{code:0,out:'',err:''};
   };
   await executePlanning({request:async(_path,body)=>reports.push(body)},job,{stateDir:dir,model:(job,options)=>answerPlanningWithCodex(job,{...options,run,env:{PATH:process.env.PATH}}),log:value=>logs.push(value)});
   assert.equal(executions,1);assert.equal(reports.at(-1).phase,'error');assert.equal(reports.at(-1).error,expected);
   assert(!reports.some(body=>body.phase==='result'));assert.deepEqual(await readdir(dir),[]);assert(logs.every(line=>!line.includes(job.request)));
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
