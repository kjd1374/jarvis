import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { completeWithSubscription, completionInput, previewCliProfile, cliBridgeRequest } from "../public/jarvis-preview-cli.mjs";

const prompt = { messages: [{ role: "user", content: "Translate 안녕하세요 into Vietnamese." }] };
test("bridge messages preserve Korean/Vietnamese when UTF-8 characters cross TCP chunks", async () => {
  const value = { content: "안녕하세요 → Xin chào" };
  const server = http.createServer(async (_req, res) => {
    res.setHeader("content-type", "application/json");
    for (const byte of Buffer.from(JSON.stringify(value))) { res.write(Buffer.from([byte])); await new Promise(r => setTimeout(r, 1)); }
    res.end();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try { assert.deepEqual((await cliBridgeRequest(`http://127.0.0.1:${server.address().port}/`, "synthetic", "/test")).body, value); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
test("preview inference uses only the ChatGPT subscription with tools disabled and removes temporary output", async () => {
  let directory, calls = 0;
  const result = await completeWithSubscription(prompt, { env: { PATH: "/synthetic/bin", HOME: "/synthetic/home", OPENAI_API_KEY: "must-not-forward", GH_TOKEN: "must-not-forward" },
    run: async (bin, args, options) => {
      calls++; assert.equal(bin, "codex"); assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.GH_TOKEN, undefined);
      if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema" };
      for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral"]) assert(args.includes(flag));
      assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
      assert(args.includes("shell_tool") && args.includes("unified_exec") && args.includes('web_search="disabled"'));
      assert(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
      directory = args[args.indexOf("--cd") + 1]; assert(directory.includes("jarvis-preview-inference-"));
      await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ content: "Xin chào" }));
      return { code: 0, out: "", err: "" };
    } });
  assert.equal(result, "Xin chào"); assert.equal(calls, 3);
  await assert.rejects(readFile(directory + "/answer.json"), /ENOENT/);
});
test("API-key login is rejected before inference and app tool/image requests cannot invoke a CLI", async () => {
  let calls = 0;
  await assert.rejects(completeWithSubscription(prompt, { run: async () => { calls++; return { code: 0, out: "Logged in using an API key" }; } }), error => error.code === "cli_login_required");
  assert.equal(calls, 1);
  for (const input of [{ ...prompt, tools: [] }, { messages: [{ role: "tool", content: "host command" }] }, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "file:///secret" } }] }] }])
    await assert.rejects(completeWithSubscription(input, { run: () => assert.fail("invalid app input must never invoke a process") }), error => error.code === "invalid_completion");
});
test("CLI quota errors stay explicit and JSON completions are validated", async () => {
  const run = async (_bin, args) => args[0] === "login" ? { code: 0, out: "ChatGPT" }
    : args[1] === "--help" ? { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema" }
    : { code: 1, out: "", err: "Usage limit reached. private diagnostic must not leak" };
  await assert.rejects(completeWithSubscription(prompt, { run }), error => error.code === "cli_limit" && !JSON.stringify(error).includes("private diagnostic"));
  assert.deepEqual(completionInput({ ...prompt, response_format: { type: "json_object" }, max_tokens: 1 }).json, true);
  const profile = previewCliProfile({ active: "local", profiles: { local: { apiKey: "do-not-copy" } }, teacher: { apiKey: "do-not-copy" } });
  assert.equal(profile.active, "jarvis"); assert.deepEqual(Object.keys(profile.profiles), ["jarvis"]);
  assert(!JSON.stringify(profile).includes("do-not-copy")); assert.equal(profile.teacher.provider, "profile");
});
test("requested JSON completions reject plain-text answers instead of claiming success", async () => {
  for (const content of ['not JSON', '{"translated":"Xin chào"}']) {
    const run = async (_bin, args) => {
      if(args[0] === "login") return {code:0,out:"ChatGPT"};
      if(args[1] === "--help") return {code:0,out:"--ignore-user-config --ignore-rules --ephemeral --output-schema"};
      await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({content})); return {code:0,out:"",err:""};
    };
    const call = completeWithSubscription({...prompt,response_format:{type:"json_object"}},{run});
    if(content === 'not JSON') await assert.rejects(call, error => error.code === "invalid_completion");
    else assert.equal(await call, content);
  }
});

test("local inference verifies the installed model and forwards only bounded completion data", async () => {
  const { createLocalInference, LOCAL_MODEL, ollamaRequest } = await import('../public/jarvis-preview-cli.mjs');
  const calls=[];
  const local=await createLocalInference({request:async(path,options)=>{
    calls.push({path,options});
    if(path==='/api/tags')return {status:200,body:{models:[{name:LOCAL_MODEL}]}};
    assert.equal(path,'/v1/chat/completions');
    assert.deepEqual(options.body,{model:LOCAL_MODEL,messages:prompt.messages,stream:false,temperature:0,max_tokens:64});
    return {status:200,body:{choices:[{message:{content:'Xin chào'},finish_reason:'stop'}]}};
  }});
  const signal=new AbortController().signal;
  assert.equal(await local.inference({...prompt,model:'other',baseUrl:'http://not-allowed',max_tokens:64},{signal}),'Xin chào');
  assert.equal(calls[1].options.signal,signal); assert.equal(local.model,LOCAL_MODEL);
  await assert.rejects(local.inference({...prompt,tools:[]}),e=>e.code==='invalid_completion');
  assert.throws(()=>ollamaRequest('/api/pull'),e=>e.code==='local_model_unavailable');
  assert.equal(calls.length,2);
  const profile=previewCliProfile({profiles:{local:{apiKey:'never-forward'}},teacher:{apiKey:'never-forward'}},'ollama');
  assert.equal(profile.profiles.jarvis.model,LOCAL_MODEL);assert.equal(profile.profiles.jarvis.warmup,false);
  assert.equal(profile.teacher.model,LOCAL_MODEL);assert(!JSON.stringify(profile).includes('never-forward'));
});
test("local model absence, HTTP failure and truncated output never fall back to CLI or claim success", async()=>{
  const { createLocalInference, LOCAL_MODEL } = await import('../public/jarvis-preview-cli.mjs');
  await assert.rejects(createLocalInference({request:async()=>({status:200,body:{models:[{name:'other-model'}]}})}),e=>e.code==='local_model_missing');
  await assert.rejects(createLocalInference({request:async()=>({status:503,body:{}})}),e=>e.code==='local_model_unavailable');
  for(const output of [{status:302,body:{}},{status:200,body:{choices:[{message:{content:'unfinished'},finish_reason:'length'}]}},{status:200,body:{choices:[{message:{content:''},finish_reason:'stop'}]}}]){
    const local=await createLocalInference({request:async path=>path==='/api/tags'?{status:200,body:{models:[{name:LOCAL_MODEL}]}}:output});
    await assert.rejects(local.inference(prompt),e=>['local_model_unavailable','invalid_completion'].includes(e.code));
  }
});
