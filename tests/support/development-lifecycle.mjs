import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { executeProjectWork } from '../../public/jarvis-runner.mjs';
// Real private bucket, scoped lease, runner image bytes and actual CLI --image contract; synthetic inference.
export async function runDevelopmentLifecycle({ base, browser, runner, approve, snapshot, projectId, options, recordCheck }) {
  const context = await browser.newContext();
  try {
    await context.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,base);return route.continue();});
    const page = await context.newPage(); await page.goto(base+'/settings'); await page.getByText(/기기 확인 번호:/).waitFor();
    await approve(await (await context.request.get(base+'/api/account')).json());
    await page.getByRole('button',{name:'기기 연결 다시 확인',exact:true}).click(); await page.getByRole('button',{name:'개인',exact:true}).click();
    await page.goto(base+'/projects/'+projectId);
    const agent = page.getByRole('region',{name:'프로젝트 AI 작업실',exact:true});
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1kAAAAASUVORK5CYII=','base64');
    await agent.getByLabel('프로젝트 사진 첨부').setInputFiles({name:'synthetic-screen.png',mimeType:'image/png',buffer:png});
    await expect(agent).toContainText('synthetic-screen.jpg');
    await agent.getByLabel('요청 방식',{exact:true}).selectOption('ask'); await agent.getByLabel('AI에게 요청',{exact:true}).fill('첨부 사진의 화면을 확인해주세요.');
    await agent.getByRole('button',{name:'요청 보내기',exact:true}).click();
    const current=async()=> (await snapshot()).data.projects.find(project=>project.id===projectId);
    await expect.poll(async()=> (await current()).automation.turns.at(-1).images?.length).toBe(1);
    const turn=(await current()).automation.turns.at(-1), scope={space:'personal',projectIds:[projectId],projectScope:'selected',provider:'codex',workVersion:1,remoteWorkVersion:1};
    const old=(await runner.request('/api/automation/claim',scope)).job; assert.notEqual(old?.id,turn.id);
    const job=(await runner.request('/api/automation/claim',{...scope,developmentVersion:1})).job; assert.equal(job.id,turn.id);
    // A browser that does not own the execution lease cannot retrieve its attachments.
    const denied=await context.request.post(base+'/api/automation/work',{headers:{Origin:base},data:{space:'personal',projectId,jobId:job.id,leaseToken:job.leaseToken,phase:'images'}});
    assert.notEqual(denied.status(),200);
    let imageSeen=false;
    const run=async(bin,args,opts)=>{
      if(bin!=='codex')return options.run(bin,args,opts);
      if(args.includes('--help'))return{code:0,out:'--ignore-user-config --ignore-rules --ephemeral --output-schema --image',err:''};
      if(args[0]==='login')return options.run(bin,args,opts);
      const path=args[args.indexOf('--image')+1];assert(path); const bytes=await readFile(path);assert.equal(bytes[0],255);assert.equal(bytes[1],216);imageSeen=true;
      assert(!path.startsWith(args[args.indexOf('--cd')+1]+'/'));return options.run(bin,args,opts);
    };
    await executeProjectWork(runner,job,{...options,run,delay:async()=>new Promise(resolve=>setTimeout(resolve,100)),previewEnabled:false});
    assert(imageSeen);assert.equal((await current()).automation.turns.at(-1).status,'completed');
    await expect(agent).toContainText('첨부 사진 1장',{timeout:12000});await page.reload();await expect(agent).toContainText('첨부 사진 1장');
    for(const name of await readdir(options.stateDir))if(name.startsWith('work-'))assert(!(await readdir(join(options.stateDir,name))).includes('attachments'));
    recordCheck('development image lifecycle: browser re-encoding + atomic file/turn save -> real private bucket -> old runner gate -> leased byte/hash retrieval -> actual codex --image -> private temporary cleanup -> reload; wrong lease rejected');
  } finally {await context.close();}
}
