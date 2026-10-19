// LaunchAgent supervisor: update only between jobs, verify before switching, roll back failed startup.
import { spawn } from 'node:child_process';
import { copyFile, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { downloadRuntime } from './jarvis-mac.mjs';
export const launcherSource = `import {readFile,writeFile,rename} from 'node:fs/promises';import {dirname,join} from 'node:path';import {pathToFileURL} from 'node:url';const directory=dirname(process.argv[1]);const file=join(directory,'runtime-current.json');let pointer=JSON.parse(await readFile(file,'utf8'));if(pointer.pending&&pointer.previous){pointer={runtime:pointer.previous};await writeFile(file+'.tmp',JSON.stringify(pointer),{mode:0o600});await rename(file+'.tmp',file);}await(await import(pathToFileURL(join(pointer.runtime,'jarvis-supervisor.mjs')).href)).supervise({runtime:pointer.runtime,directory,config:process.argv[process.argv.indexOf('--config')+1]});\n`;
export function newerVersion(next, current) {
  if(!/^2\.\d+\.\d+$/.test(next)||!/^2\.\d+\.\d+$/.test(current))return false;
  const a=next.split('.').map(Number),b=current.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export async function stageUpdate({runtime,directory,origin,transport=fetch,run}) {
  const current=JSON.parse(await readFile(join(runtime,'jarvis-runtime.json'),'utf8'));
  const response=await transport(origin+'/jarvis-runtime.json',{redirect:'error',signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw Error('update_manifest_unavailable');
  const next=await response.json();
  if(!newerVersion(next.version,current.version))return null;
  const candidate=join(directory,'runtime-'+randomUUID());
  try{
    const version=await downloadRuntime(origin,candidate,transport);
    if(version!==next.version)throw Error('update_release_changed');
    await copyFile(join(runtime,'cloudflared'),join(candidate,'cloudflared'));
    const checked=await run(process.execPath,[join(candidate,'jarvis-runner.mjs'),'--self-check']);
    if(checked.code!==0)throw Error('update_self_check_failed');
    return candidate;
  }catch(e){await rm(candidate,{recursive:true,force:true});throw e;}
}
export async function supervise({runtime,directory,config,transport=fetch,spawnProcess=spawn,clock=Date.now,signal}) {
  const settings=JSON.parse(await readFile(config,'utf8'));
  const pointer=join(directory,'runtime-current.json');
  const save=async value=>{await writeFile(pointer+'.tmp',JSON.stringify(value),{mode:0o600});await rename(pointer+'.tmp',pointer);};
  const run=(bin,args)=>new Promise(resolve=>{
    const p=spawnProcess(bin,args,{stdio:'ignore'});const timer=setTimeout(()=>p.kill(),30_000);
    p.once('error',()=>{clearTimeout(timer);resolve({code:-1});});p.once('exit',code=>{clearTimeout(timer);resolve({code});});
  });
  let child, checking=false, stopping=false, lastCheck=0;
  const stop=()=>{stopping=true;child?.kill('SIGTERM');};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);signal?.addEventListener('abort',stop,{once:true});
  const start=async selected=>{
    let ready=false;
    return new Promise(resolve=>{
      child=spawnProcess(process.execPath,[join(selected,'jarvis-runner.mjs'),'--config',config],{stdio:['ignore','inherit','inherit','ipc']});
      const timer=setTimeout(()=>{if(!ready)child.kill('SIGTERM');},90_000);
      child.on('message',async message=>{
        if(message?.type==='ready'){ready=true;clearTimeout(timer);if(selected!==runtime){await save({runtime:selected,previous:runtime});runtime=selected;} }
        if(message?.type!=='idle'||checking||stopping)return;
        checking=true;
        try{
          if(!message.activePreviews && clock()-lastCheck>=30*60_000){
            lastCheck=clock();
            const candidate=await stageUpdate({runtime:selected,directory,origin:settings.origin,transport,run});
            if(candidate){
              // Parent retains the old runtime until the candidate authenticates and announces readiness.
              child.removeAllListeners('exit');child.once('exit',()=>resolve({candidate}));child.kill('SIGTERM');return;
            }
          }
        }catch{console.log('자동 업데이트를 적용하지 못했습니다. 현재 실행기로 계속합니다.');}
        finally{checking=false;}
        if(child.connected)child.send({type:'continue'});
      });
      child.once('error',()=>{clearTimeout(timer);resolve({ready:false});});
      child.once('exit',()=>{clearTimeout(timer);resolve({ready});});
    });
  };
  try{
    while(!stopping){
      const outcome=await start(runtime);
      if(outcome.candidate){
        const previous=runtime;await save({runtime:outcome.candidate,previous,pending:true});
        const candidate=await start(outcome.candidate);
        if(!candidate.ready && runtime===previous){await save({runtime:previous});console.log('새 실행기의 시작을 확인하지 못해 이전 버전으로 복구했습니다.');}
        if(candidate.candidate){await save({runtime:candidate.candidate,previous:runtime,pending:true});runtime=candidate.candidate;}
        continue;
      }
      if(!stopping)await new Promise(r=>setTimeout(r,15_000));
    }
  }finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);signal?.removeEventListener('abort',stop);}
}
