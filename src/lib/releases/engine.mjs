import { createHash, randomBytes } from 'node:crypto';
export const workflowRepository = process.env.JARVIS_RELEASE_WORKFLOW_REPOSITORY || 'kjd1374/jarvis';
export const releaseError = code => Object.assign(new Error(code), { code });
const roots = { github: 'https://api.github.com', vercel: 'https://api.vercel.com', supabase: 'https://api.supabase.com' };
export function cloudApi(credentials, transport = fetch) {
  return async (provider, path, method = 'GET', body) => {
    const c = credentials[provider];
    if (!c?.token || !roots[provider] || !path.startsWith('/') || path.includes('://')) throw releaseError(`${provider}_connection_required`);
    const url = new URL(roots[provider] + path);
    if (provider === 'vercel' && c.organization) url.searchParams.set('teamId', c.organization);
    const r = await transport(url, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) throw Object.assign(releaseError(r.status === 401 || r.status === 403 ? `${provider}_connection_required` : r.status === 429 ? 'provider_rate_limited' : `${provider}_request_failed`), {status:r.status});
    const bytes = await r.arrayBuffer(); if (bytes.byteLength > 4_000_000) throw releaseError('provider_response_large');
    return bytes.byteLength ? JSON.parse(Buffer.from(bytes).toString()) : {};
  };
}
export async function sourceFile(api, repository, sha, path, max = 200_000) {
  const file = await api('github', `/repos/${repository}/contents/${path}?ref=${sha}`);
  if (!file || file.type !== 'file' || file.encoding !== 'base64' || file.size > max) throw releaseError('source_unavailable');
  const bytes = Buffer.from(file.content, 'base64');
  const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (digest !== file.sha || bytes.length !== file.size) throw releaseError('source_changed');
  return { text: bytes.toString('utf8'), sha: file.sha };
}
export async function freeAccounts(api, credentials, database) {
  const team = credentials.vercel?.organization;
  let a = await api('vercel', team ? `/v2/teams/${team}` : '/v2/user');
  if (!team && /^team_[a-zA-Z0-9]+$/.test(a?.user?.defaultTeamId ?? '')) { credentials.vercel.organization = a.user.defaultTeamId; a = await api('vercel', `/v2/teams/${a.user.defaultTeamId}`); }
  const account = a?.team ?? a?.user ?? a;
  if (account?.billing?.plan !== 'hobby') throw releaseError('free_vercel_required');
  if (database !== 'none') {
    const org = credentials.supabase?.organization;
    if (!org || !/^[a-zA-Z0-9_-]+$/.test(org)) throw releaseError('supabase_connection_required');
    const account = await api('supabase', `/v1/organizations/${org}`);
    if (account?.plan !== 'free') throw releaseError('free_supabase_required');
  }
  const id = account.id ?? account.uid; if (typeof id !== 'string') throw releaseError('vercel_connection_required');
  return id;
}
export async function checkSource(api, repository, sha) {
  const checks=await api('github',`/repos/${repository}/commits/${sha}/check-runs?per_page=100`);
  const status=await api('github',`/repos/${repository}/commits/${sha}/status`);
  if(!checks||!Array.isArray(checks.check_runs)||!status)throw releaseError('source_checks_unavailable');
  if(checks.total_count>100)throw releaseError('source_checks_incomplete');
  if(checks.check_runs.some(c=>c.status!=='completed')||status.total_count>0&&status.state==='pending')throw releaseError('source_checks_pending');
  if(checks.check_runs.some(c=>!['success','neutral','skipped'].includes(c.conclusion))||status.total_count>0&&status.state!=='success')throw releaseError('source_checks_failed');
  return checks.check_runs.filter(c=>c.conclusion==='success').length+Number(status.total_count||0);
}
export async function inspectRelease({ project, repository, database = 'auto', databaseId, vercelId, ownerId }, api, credentials) {
  if (!['auto', 'none', 'new', 'existing'].includes(database) || database === 'existing' && !/^[a-z]{20}$/.test(databaseId ?? '') || vercelId && !/^prj_[a-zA-Z0-9]+$/.test(vercelId)) throw releaseError('invalid_release_options');
  if (repository === workflowRepository) throw releaseError('self_release_unsupported');

  const repo = await api('github', `/repos/${repository}`);
  if (!repo || String(repo.full_name).toLowerCase() !== repository || repo.archived || repo.disabled) throw releaseError('repository_unavailable');
  const head = await api('github', `/repos/${repository}/commits/${encodeURIComponent(repo.default_branch)}`);
  if (!/^[a-f0-9]{40}$/.test(head?.sha ?? '')) throw releaseError('source_unavailable');
  const checks = await checkSource(api, repository, head.sha);
  const tree = await api('github', `/repos/${repository}/git/trees/${head.sha}?recursive=1`);
  if (!tree || tree.truncated || tree.tree.length > 5000) throw releaseError('source_tree_incomplete');
  const paths = tree.tree.filter(f => f.type === 'blob').map(f => f.path);
  if (paths.some(p => /(^|\/)\.env(?:\.|$)/.test(p) && !/\.env\.(example|sample|template)$/.test(p))) throw releaseError('sensitive_source_files');
  if (paths.includes('jarvis.project.json') && JSON.parse((await sourceFile(api, repository, head.sha, 'jarvis.project.json', 100_000)).text).database === 'sqlite') throw releaseError('local_storage_requires_conversion');
  const pkg = paths.includes('package.json') ? JSON.parse((await sourceFile(api, repository, head.sha, 'package.json', 100_000)).text) : {};
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  if (dependencies.sqlite3 || dependencies['better-sqlite3'] || paths.some(p => /\.(sqlite|sqlite3|db)$/.test(p))) throw releaseError('local_storage_requires_conversion');
  if (paths.includes('storage.mjs') && /node:sqlite|DATA_DIR|better-sqlite3/.test((await sourceFile(api, repository, head.sha, 'storage.mjs')).text)) throw releaseError('local_storage_requires_conversion');
  const framework = dependencies.next ? 'nextjs' : dependencies.vite ? 'vite' : dependencies.express ? 'express' : !pkg.scripts?.start && (paths.includes('index.html') || paths.includes('public/index.html')) ? 'static' : undefined;
  if (!framework || paths.some(p => /^(?:src\/)?config\.example\.json$/.test(p)) && /구독|CLI/i.test(project.description)) throw releaseError('runtime_conversion_required');
  const requestedAuto = database === 'auto';
  if (requestedAuto) {
    const previousDb = project.release?.databaseId ?? project.setup?.result?.supabaseProjectId;
    if (previousDb) { database = 'existing'; databaseId = previousDb; }
    else database = dependencies['@supabase/supabase-js'] || paths.some(p => /^supabase\/migrations\/.+\.sql$/.test(p)) ? 'new' : 'none';
  }
  const vercelAccount = await freeAccounts(api, credentials, database);
  const migrations = database === 'new' ? tree.tree.filter(f => f.type === 'blob' && /^supabase\/migrations\/[a-zA-Z0-9_-]+\.sql$/.test(f.path)).map(f => ({ path: f.path, sha: f.sha })).sort((a,b) => a.path.localeCompare(b.path)) : [];
  if (migrations.length > 30 || database === 'new' && migrations.length === 0) throw releaseError('database_schema_required');
  const name = 'jarvis-live-' + createHash('sha256').update(`${ownerId}:${project.space}:${project.id}`).digest('hex').slice(0,20);
  const prior = project.release;
  let previousId = prior?.vercelId ?? project.setup?.result?.vercelProjectId;
  if (!vercelId && !previousId) {
    const projects = await api('vercel', '/v9/projects?limit=100');
    const matches = projects?.projects?.filter(p => p.accountId === vercelAccount && String(p.link?.repoId) === String(repo.id)) ?? [];
    if (matches.length > 1) throw releaseError('release_project_selection_required');
    previousId = matches[0]?.id;
  }
  if (requestedAuto && database === 'new' && (previousId || vercelId)) throw releaseError('existing_database_selection_required');
  const plan = { repository, repoId: repo.id, branch: repo.default_branch, sha: head.sha, framework, database,
    name, vercelAccount, ...(framework === 'static' && paths.includes('public/index.html') ? { outputDirectory: 'public' } : {}), ...(databaseId ? { databaseId } : {}), ...(vercelId || previousId ? { vercelId: vercelId || previousId } : {}),
    ...(credentials.vercel?.organization ? { team: credentials.vercel.organization } : {}), ...(database !== 'none' ? { organization: credentials.supabase.organization } : {}),
    migrations, localData: project.setup?.result?.database === 'sqlite' || !!project.automation?.turns.some(t => t.result?.preview?.dataPersistence === 'project'),
    notes: [checks?`GitHub 자동 검사 ${checks}개 통과를 확인했습니다.`:'이 커밋의 GitHub 자동 검사 근거가 없습니다. 배포 후 주요 기능을 직접 확인해야 합니다.', '무료 계정 범위에서 실행하며 유료 플랜으로 전환하지 않습니다.', '기존 접근 정책과 로컬 데이터는 보존합니다. 로컬 데이터는 자동으로 복사하지 않습니다.', '실제 서비스 기능을 확인한 뒤 사용 중으로 전환합니다.', ...(database === 'existing' ? ['기존 DB의 스키마와 자료는 수정하지 않습니다.'] : []), ...(database === 'new' ? ['저장소의 고정된 마이그레이션을 새 DB에 적용합니다.'] : [])] };
  if (plan.vercelId) await verifyVercel(api, plan.vercelId, plan);
  if (database === 'existing') await verifyDatabase(api, databaseId, plan.organization);
  return plan;
}
export async function verifyVercel(api, id, plan) {
  if (id === process.env.VERCEL_PROJECT_ID || id === 'prj_ekUryQ33gIha0UqHfP5WtoD90NEG') throw releaseError('self_release_unsupported');
  const p = await api('vercel', `/v9/projects/${id}`);
  if (!p || p.accountId !== plan.vercelAccount || String(p.link?.repoId) !== String(plan.repoId)) throw releaseError('deployment_repository_mismatch');
  return p;
}
export async function verifyDatabase(api, id, organization) {
  const p = await api('supabase', `/v1/projects/${id}`);
  if (!p) throw releaseError('database_scope_mismatch');
  if ((p.organization_slug ?? p.organization_id) !== organization) { const org = await api('supabase', `/v1/organizations/${organization}`); if (![organization,org?.id,org?.slug].filter(Boolean).includes(p.organization_slug ?? p.organization_id)) throw releaseError('database_scope_mismatch'); }
  return p;
}
export function migrationQuery(files) {
  const literal = v => "'" + v.replaceAll("'", "''") + "'";
  const blocks = files.map(f => {
    const tag = '$jarvis_' + f.sha + '$'; if (f.text.includes(tag)) throw releaseError('invalid_migration');
    return `if exists(select 1 from jarvis_release.migrations where path=${literal(f.path)} and sha<>${literal(f.sha)}) then raise exception 'migration_changed'; end if;
if not exists(select 1 from jarvis_release.migrations where path=${literal(f.path)}) then execute ${tag}${f.text}${tag}; insert into jarvis_release.migrations(path,sha) values(${literal(f.path)},${literal(f.sha)}); end if;`;
  }).join('\n');
  return `do $jarvis_outer$ begin perform pg_advisory_xact_lock(hashtext('jarvis-live-migrations')); create schema if not exists jarvis_release; revoke all on schema jarvis_release from public; create table if not exists jarvis_release.migrations(path text primary key,sha text not null); ${blocks} end $jarvis_outer$;`;
}
// Each step is short. Persist creation intent before the external call; uncertain
// creation is recovered by identity lookup and never a blind duplicate POST.
export async function advanceRelease(release, api, credentials, checkpoint, transport = fetch) {
  const r = structuredClone(release), p = r.plan;
  if (await freeAccounts(api, credentials, p.database) !== p.vercelAccount) throw releaseError('provider_scope_changed');
  if (p.team !== credentials.vercel?.organization || p.database !== 'none' && p.organization !== credentials.supabase?.organization) throw releaseError('provider_scope_changed');
  const save = async patch => { Object.assign(r, patch); await checkpoint(r); };
  const create = async (intent, provider, path, body) => {
    await save({[intent]:true});
    try { return await api(provider,path,'POST',body); }
    catch (error) {
      // A definite validation/authorization refusal can be retried after fixing
      // the prerequisite. Timeouts and server errors retain uncertain intent.
      if ([400,401,403,404,409,422,429].includes(error.status)) await save({[intent]:false});
      throw error;
    }
  };
  if (r.phase === 'database') {
    if (p.database === 'none') return { ...r, phase: 'environment', databaseStatus: 'not_required' };
    if (p.database === 'existing') { const db = await verifyDatabase(api, p.databaseId, p.organization); if (db.status !== 'ACTIVE_HEALTHY') throw releaseError('database_not_ready'); return { ...r, databaseId: p.databaseId, databaseStatus: db.status, phase: 'environment' }; }
    const list = await api('supabase', '/v1/projects');
    const org = await api('supabase', `/v1/organizations/${p.organization}`), orgIds = [p.organization,org?.id,org?.slug].filter(Boolean);
    let db = list.find(d => d.name === p.name && orgIds.includes(d.organization_slug ?? d.organization_id));
    if (db && !r.databaseIntent && !r.databaseId) throw releaseError('resource_identity_conflict');
    if (!db) {
      if (r.databaseIntent) throw releaseError('resource_creation_uncertain');
      db = await create('databaseIntent', 'supabase', '/v1/projects', { name: p.name, organization_slug: p.organization, region: 'ap-northeast-2', db_pass: randomBytes(32).toString('base64url') });
    }
    const id = db.ref ?? db.id; if (!/^[a-z]{20}$/.test(id ?? '')) throw releaseError('database_not_ready');
    return { ...r, databaseId: id, phase: 'database_wait', databaseStatus: db.status ?? 'COMING_UP' };
  }
  if (r.phase === 'database_wait') {
    const db = await verifyDatabase(api, r.databaseId, p.organization);
    if (db.status !== 'ACTIVE_HEALTHY') return { ...r, databaseStatus: db.status };
    const files = []; let total = 0;
    for (const migration of p.migrations) { const f = await sourceFile(api, p.repository, p.sha, migration.path); if (f.sha !== migration.sha || (total += f.text.length) > 300_000 || f.text.includes('$jarvis_outer$')) throw releaseError('migration_changed'); files.push({ ...migration, text: f.text }); }
    await api('supabase', `/v1/projects/${r.databaseId}/database/query`, 'POST', { query: migrationQuery(files) });
    return { ...r, databaseStatus: 'ACTIVE_HEALTHY', migrationsApplied: files.map(f => f.path), phase: 'environment' };
  }
  if (r.phase === 'environment') {
    let project = r.vercelId || p.vercelId ? await verifyVercel(api, r.vercelId ?? p.vercelId, p) : await api('vercel', `/v9/projects/${p.name}`);
    if (project && !r.vercelId && !p.vercelId && !r.vercelIntent) throw releaseError('resource_identity_conflict');
    if (!project) {
      if (r.vercelIntent) throw releaseError('resource_creation_uncertain');
      project = await create('vercelIntent', 'vercel', '/v11/projects', { name: p.name, framework: p.framework === 'static' ? null : p.framework, gitRepository: { type: 'github', repo: p.repository }, ...(p.framework === 'static' ? { outputDirectory: p.outputDirectory ?? null } : {}) });
    }
    if (!/^prj_[a-zA-Z0-9]+$/.test(project?.id ?? '') || project.accountId !== p.vercelAccount || String(project.link?.repoId) !== String(p.repoId)) throw releaseError('deployment_repository_mismatch');
    await save({ vercelId: project.id });
    const keys = {};
    if (r.databaseId) {
      await verifyDatabase(api, r.databaseId, p.organization);
      const dbKeys = await api('supabase', `/v1/projects/${r.databaseId}/api-keys?reveal=true`);
      const anon = dbKeys.find(k => k.name === 'anon')?.api_key;
      if (!anon) throw releaseError('database_key_unavailable');
      Object.assign(keys, { SUPABASE_URL: `https://${r.databaseId}.supabase.co`, SUPABASE_PUBLISHABLE_KEY: anon });
      if (p.framework === 'nextjs') Object.assign(keys, { NEXT_PUBLIC_SUPABASE_URL: keys.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon });
      if (p.framework === 'vite') Object.assign(keys, { VITE_SUPABASE_URL: keys.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: anon });
      // Never distribute service_role/management keys to deployed code or browsers.
      for (const [key,value] of Object.entries(keys)) {
        const result = await api('vercel', `/v10/projects/${project.id}/env?upsert=true`, 'POST', { key, value, type: 'encrypted', target: ['production'] });
        if (!result) throw releaseError('environment_update_failed');
      }
    }
    return { ...r, phase: 'deployment', environmentKeys: Object.keys(keys) };
  }
  if (r.phase === 'deployment') {
    await checkSource(api, p.repository, p.sha);
    await verifyVercel(api, r.vercelId, p);
    const list = await api('vercel', `/v6/deployments?projectId=${r.vercelId}&limit=100`);
    let d = list?.deployments?.find(d => d.meta?.jarvisRelease === r.id && d.meta?.jarvisReleaseSha === p.sha);
    if (!d) {
      if (r.deploymentIntent) throw releaseError('deployment_creation_uncertain');
      d = await create('deploymentIntent', 'vercel', '/v13/deployments', { name: p.name, project: r.vercelId, target: 'production', gitSource: { type: 'github', repoId: p.repoId, ref: p.sha, sha: p.sha }, meta: { jarvisRelease: r.id, jarvisReleaseSha: p.sha } });
    }
    const id = d.id ?? d.uid; if (!/^dpl_[a-zA-Z0-9]+$/.test(id ?? '')) throw releaseError('deployment_not_ready');
    return { ...r, phase: 'deployment_wait', deploymentId: id, deploymentStatus: d.readyState ?? d.state ?? 'QUEUED' };
  }
  if (r.phase === 'deployment_wait') {
    const d = await api('vercel', `/v13/deployments/${r.deploymentId}`);
    if (!d || d.projectId !== r.vercelId || d.meta?.githubCommitSha !== p.sha || d.target !== 'production') throw releaseError('deployment_source_mismatch');
    if (['ERROR','CANCELED'].includes(d.readyState)) throw releaseError('deployment_build_failed');
    if (d.readyState !== 'READY') return { ...r, deploymentStatus: d.readyState };
    const aliases = await api('vercel', `/v2/deployments/${r.deploymentId}/aliases`);
    const url = aliases?.aliases?.find(a => /^[a-z0-9-]+\.vercel\.app$/.test(a.alias))?.alias ?? d.url;
    if (!/^[a-z0-9-]+\.vercel\.app$/.test(url ?? '')) throw releaseError('deployment_url_invalid');
    return { ...r, phase: 'health', deploymentStatus: 'READY', url: `https://${url}` };
  }
  if (r.phase === 'health') {
    await verifyVercel(api, r.vercelId, p);
    const d = await api('vercel', `/v13/deployments/${r.deploymentId}`);
    if (!d || d.meta?.githubCommitSha !== p.sha || d.readyState !== 'READY') throw releaseError('deployment_source_mismatch');
    const alias = await api('vercel', `/v4/aliases/${new URL(r.url).hostname}`);
    if (alias?.deployment?.id !== r.deploymentId) throw releaseError('deployment_alias_changed');
    const response = await transport(r.url, { method: 'GET', cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Jarvis-Release-Check/1' } });
    await response.body?.cancel();
    if ([301,302,303,307,308,401,403].includes(response.status)) return { ...r, phase: 'done', healthStatus: response.status, status: 'deployed', error: 'deployment_access_review' };
    if (response.status !== 200) return { ...r, healthStatus: response.status, status: 'failed', error: 'deployment_health_failed' };
    return { ...r, phase: 'done', healthStatus: 200, status: 'deployed' };
  }
  return r;
}
