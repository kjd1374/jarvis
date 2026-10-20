import {test,expect} from '../support/fixtures';
import {automationWorkspace} from '../support/automation';
import {emptyWorkspace,type WorkspaceData} from '../../src/lib/workspace/types';
import type {ProjectRelease} from '../../src/lib/releases/state';
import {randomUUID} from 'node:crypto';
const stamp='2026-10-20T01:00:00.000Z';
function release():ProjectRelease{return{id:randomUUID(),status:'planned',phase:'database',createdAt:stamp,updatedAt:stamp,ownerDevice:'synthetic-device',history:[],plan:{repository:'example/synthetic',repoId:77,branch:'main',sha:'a'.repeat(40),framework:'nextjs',database:'none',name:'jarvis-live-'+'a'.repeat(20),vercelAccount:'synthetic',migrations:[],localData:false,notes:['무료 계정 범위에서 실행합니다.','기존 로컬 데이터는 보존합니다.']}};}
async function cloud(page:import('@playwright/test').Page){
 const data=automationWorkspace(stamp);data.projects[0].stage='development';
 const remote:Record<string,{data:WorkspaceData;revision:number}>={company:{data,revision:1},personal:{data:emptyWorkspace(),revision:1}};
 const requests:Record<string,unknown>[]=[];
 await page.route('**/api/account',r=>r.fulfill({json:{enabled:true,configured:true,authenticated:true,accountId:'11111111-1111-4111-8111-111111111111',deviceId:'synthetic-device'}}));
 await page.route('**/api/workspace?**',r=>r.fulfill({json:remote[new URL(r.request().url()).searchParams.get('space')!]}));
 await page.route('**/api/workspace',async r=>{const b=r.request().postDataJSON();remote[b.space]={data:b.data,revision:b.revision+1};await r.fulfill({json:{revision:b.revision+1}});});
 await page.route('**/api/projects/release',async route=>{
  const b=route.request().postDataJSON();requests.push(b);let r=remote.company.data.projects[0].release;
  if(b.action==='plan')r=release();
  if(b.action==='start'||b.action==='retry'){expect(b.reviewed).toBe(true);r={...r!,status:'queued',executionId:randomUUID(),runUntil:'2099-01-01T00:00:00.000Z',workflowUrl:'https://github.com/kjd1374/jarvis/actions/runs/123'};}
  if(b.action==='complete'){expect(b.functionalChecked).toBe(true);remote.company.data.projects[0].stage='live';remote.company.data.projects[0].launchUrl=r!.url;r={...r!,confirmedAt:stamp};}
  remote.company.data.projects[0].release=r;remote.company.revision++;
  await route.fulfill({json:{release:r??null}});
 });
 return{remote,requests};
}
test('운영 구성 검토·클라우드 실행·기능 확인을 거쳐 사용 중으로 전환하고 개발로 복귀한다',async({page})=>{
 const f=await cloud(page);await page.goto('/projects/auto-project');
 const panel=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^개발 완료·운영 전환/})}).first();await panel.locator(':scope > summary').click();
 await panel.getByRole('button',{name:'운영 구성 검사',exact:true}).click();await expect(panel).toContainText('aaaaaaaa');
 const start=panel.getByRole('button',{name:'클라우드에서 배포 시작',exact:true});await expect(start).toBeDisabled();await panel.getByRole('checkbox',{name:/고정 코드·무료 계정/}).check();await start.click();await expect(panel).toContainText('브라우저를 닫아도 GitHub에서 계속 처리합니다.');
 f.remote.company.data.projects[0].release={...f.remote.company.data.projects[0].release!,status:'deployed',phase:'done',url:'https://synthetic-release.vercel.app',healthStatus:200,updatedAt:'2026-10-20T02:00:00.000Z'};f.remote.company.revision++;
 await page.reload();await expect(panel.getByRole('link',{name:'운영 화면 확인 ↗',exact:true})).toHaveAttribute('href','https://synthetic-release.vercel.app');
 const complete=panel.getByRole('button',{name:'개발 완료 · 사용 중으로 전환',exact:true});await expect(complete).toBeDisabled();await panel.getByRole('checkbox',{name:/운영 화면에서 주요 기능/}).check();await complete.click();
 await expect(page.getByRole('link',{name:'서비스 열기 ↗',exact:true})).toHaveAttribute('href','https://synthetic-release.vercel.app');
 const live=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^개발 완료·운영 전환/})}).first();await live.getByRole('button',{name:'수정 개발로 돌아가기',exact:true}).click();await expect(page.getByRole('navigation',{name:'개발 작업 보기',includeHidden:true})).toBeAttached();
 expect(f.requests.filter(b=>b.action==='start')).toHaveLength(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('운영 구성은 로컬 자료를 유지하고 기존 DB 선택 시 ID를 요구한다',async({page})=>{
 await cloud(page);await page.goto('/projects/auto-project');const panel=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^개발 완료·운영 전환/})}).first();await panel.locator(':scope > summary').click();await panel.getByLabel('운영 데이터베이스',{exact:true}).selectOption('existing');await expect(panel.getByLabel('Supabase 프로젝트 ID',{exact:true})).toHaveAttribute('required','');await expect(panel).toContainText('맥미니가 꺼져 있어도 배포가 이어집니다.');
});

test('복원한 운영 요청은 검토 후에만 기존 자원으로 재개한다',async({page})=>{
 const f=await cloud(page);f.remote.company.data.projects[0].release={...release(),status:'interrupted',error:'imported_request_review'};
 await page.goto('/projects/auto-project');const panel=page.getByRole('group',{name:'프로젝트 운영 전환',exact:true});
 const retry=panel.getByRole('button',{name:'기존 자원으로 이어서 확인',exact:true});await expect(retry).toBeDisabled();await panel.getByRole('checkbox',{name:/고정 코드·무료 계정/}).check();await retry.click();await expect(panel).toContainText('클라우드 실행 대기');expect(f.requests.filter(b=>b.action==='retry')).toHaveLength(1);
});
test('운영 호환성 오류는 수정 요청 초안으로 전달하고 자동 실행하지 않는다',async({page})=>{
 const f=await cloud(page);await page.route('**/api/projects/release',r=>r.fulfill({status:409,json:{error:'runtime_conversion_required',code:'release_rejected'}}));
 await page.goto('/projects/auto-project');const panel=page.getByRole('group',{name:'프로젝트 운영 전환',exact:true});await panel.locator(':scope > summary').click();await panel.getByRole('button',{name:'운영 구성 검사',exact:true}).click();await panel.getByRole('button',{name:'필요한 수정을 개발 대화에 작성',exact:true}).click();await expect(page.getByLabel('AI에게 요청',{exact:true})).toHaveValue(/상시 서버/);expect(f.remote.company.data.projects[0].automation?.turns??[]).toHaveLength(0);
});
