import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { executePlanning, VERSION } from '../../public/jarvis-runner.mjs';

// Real private server/Auth/storage and browser, synthetic inference only.
export async function runPlanningLifecycle({ base, browser, runner, approve, snapshot, recordCheck }) {
  assert.equal(base,'http://127.0.0.1:4317');
  const dir=await mkdtemp(join(tmpdir(),'jarvis-planning-lifecycle-'));
  const context=await browser.newContext();let models=0;
  try {
    await context.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,base);return route.continue();});
    const page=await context.newPage();await page.goto(base+'/settings');
    await page.getByText(/기기 확인 번호:/).waitFor();await approve(await(await context.request.get(base+'/api/account')).json());
    await page.getByRole('button',{name:'기기 연결 다시 확인',exact:true}).click();
    await page.getByRole('button',{name:'개인',exact:true}).click();
    await expect(page.getByRole('button',{name:'개인',exact:true})).toHaveAttribute('aria-pressed','true');
    const before=(await snapshot()).data;
    await page.goto(base+'/projects');await page.getByRole('button',{name:'프로젝트 만들기',exact:true}).click();
    const form=page.getByRole('dialog',{name:'프로젝트 만들기'});
    await expect(form.getByRole('radio',{name:/아이디어부터/})).toBeChecked();
    await form.getByLabel('프로젝트 이름',{exact:true}).fill('합성 저장소 없는 기획');
    await form.getByLabel('프로젝트 설명',{exact:true}).fill('일상을 정리하는 개인 도구');
    await form.getByRole('button',{name:'프로젝트 저장',exact:true}).click();
    const doc=page.getByRole('region',{name:'프로젝트 기획안'}),chat=page.getByRole('region',{name:'기획 AI 대화'});
    await expect(doc).toBeVisible();
    await expect.poll(async()=> (await snapshot()).data.projects.find(p=>p.name==='합성 저장소 없는 기획')?.id).toBeTruthy();
    const project=(await snapshot()).data.projects.find(p=>p.name==='합성 저장소 없는 기획');
    const scope={space:'personal',projectIds:[project.id],projectScope:'selected',provider:'codex',runnerVersion:VERSION,workVersion:1};
    await chat.getByLabel('기획 AI에게 요청').fill('첫 기획안을 만들어주세요');await chat.getByRole('button',{name:'기획 요청 보내기',exact:true}).click();
    const current=async()=> (await snapshot()).data.projects.find(p=>p.id===project.id);
    await expect.poll(async()=> (await current()).planning.turns.at(-1)?.status).toBe('queued');
    assert.equal((await runner.request('/api/automation/claim',scope)).job,null,'old runner cannot claim planning');
    const first=(await runner.request('/api/automation/claim',{...scope,planningVersion:1})).job;assert.equal(first.kind,'planning');assert.equal(first.projectId,project.id);
    await executePlanning(runner,first,{stateDir:dir,model:async()=>{models++;return{reply:'첫 범위를 정리했습니다.',document:'# 첫 기획안\n사용자와 완료 기준'};},log(){}});
    await expect(doc).toContainText('사용자와 완료 기준');await expect(doc).toContainText('버전 1');
    await chat.getByLabel('기획 AI에게 요청').fill('두 번째 제안');await chat.getByRole('button',{name:'기획 요청 보내기',exact:true}).click();
    await expect.poll(async()=> (await current()).planning.turns.at(-1)?.status).toBe('queued');
    const second=(await runner.request('/api/automation/claim',{...scope,planningVersion:1})).job;
    await doc.getByRole('button',{name:'직접 편집',exact:true}).click();await doc.getByLabel('기획안 내용').fill('# 직접 수정한 기획\n반드시 유지할 결정');
    await doc.getByRole('button',{name:'기획안 저장',exact:true}).click();await expect.poll(async()=> (await current()).planning.document.revision).toBe(2);
    await executePlanning(runner,second,{stateDir:dir,model:async()=>{models++;return{reply:'변경 제안입니다.',document:'# 갱신 제안\n새 완료 기준'};},log(){}});
    await expect(chat).toContainText('직접 편집된 기획안을 보존했습니다');await expect(doc).toContainText('반드시 유지할 결정');
    await chat.getByText('AI 기획안 제안 보기',{exact:true}).click();await chat.getByRole('button',{name:'현재 기획안에 제안 적용',exact:true}).click();
    await expect.poll(async()=> (await current()).planning.document.revision).toBe(3);assert.equal(models,2);
    const saved=(await snapshot()).data;assert.equal(saved.services.length,before.services.length);assert.equal((await current()).setup,undefined);
    await page.reload();await expect(doc).toContainText('새 완료 기준');
    await page.screenshot({path:'test-results/project-lifecycle-planning.png',fullPage:true});
    await page.getByRole('button',{name:'개발 시작',exact:true}).click();await expect.poll(async()=> (await current()).stage).toBe('development');
    const p=await current();assert.equal(p.setup.target,'mac');assert.equal(p.planning.document.content,'# 갱신 제안\n새 완료 기준');
    recordCheck('repository-free planning: browser creation -> real private claim/report -> versioned plan -> concurrent manual edit proposal -> reload -> development handoff; no external resources or paid model calls');
  } finally {await context.close();await rm(dir,{recursive:true,force:true});}
}
