import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePlanning, answerPlanningWithCodex, validatePlanningAnswer, RunnerError } from '../public/jarvis-runner.mjs';
const job = { kind:'planning', id:'11111111-1111-4111-8111-111111111111', space:'personal', projectId:'idea', leaseToken:'22222222-2222-4222-8222-222222222222',attempt:1,request:'기획안을 정리',name:'합성 기획',description:'개인 도구',document:'기존 결정',history:[] };
const answer={reply:'범위를 정리했습니다.',document:'# 합성 기획\n가정 확인 필요'};
test('planning uses the existing tool-disabled subscription completion without GitHub or paid API',async()=>{
 const calls=[];
 const run=async(bin,args,options)=>{calls.push({bin,args});assert.equal(bin,'codex');
  if(args[0]==='login')return{code:0,out:'Logged in using ChatGPT',err:''};
  if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
  assert(args.includes('shell_tool'));assert(args.includes('--disable'));assert(args.includes('read-only'));assert(options.input.includes('확인되지 않은'));
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({content:JSON.stringify(answer)}));return{code:0,out:'',err:''};
 };
 assert.deepEqual(await answerPlanningWithCodex(job,{run,env:{PATH:process.env.PATH}}),answer);assert.equal(calls.length,3);
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
 for(const [mode,expected] of [['timeout','cli_timeout'],['completion','invalid_completion'],['plan','invalid_planning_answer']]){
  const dir=await mkdtemp(join(tmpdir(),'planning-failure-')),reports=[],logs=[];let executions=0;
  try{
   const run=async(_bin,args,options)=>{
    if(args[0]==='login')return{code:0,out:'Logged in using ChatGPT',err:''};
    if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema',err:''};
    executions++;assert.equal(options.timeout,120000);
    if(mode==='timeout')throw new RunnerError('command_timeout');
    await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({content:mode==='completion'?'unfinished JSON':JSON.stringify({reply:'synthetic reply',document:''})}));return{code:0,out:'',err:''};
   };
   await executePlanning({request:async(_path,body)=>reports.push(body)},job,{stateDir:dir,model:(job,options)=>answerPlanningWithCodex(job,{...options,run,env:{PATH:process.env.PATH}}),log:value=>logs.push(value)});
   assert.equal(executions,1);assert.equal(reports.at(-1).phase,'error');assert.equal(reports.at(-1).error,expected);
   assert(!reports.some(body=>body.phase==='result'));assert.deepEqual(await readdir(dir),[]);assert(logs.every(line=>!line.includes(job.request)));
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
