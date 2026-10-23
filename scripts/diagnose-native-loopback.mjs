// CI-only evidence for Issue #79. These probes do not replace native assertions.
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { developmentEnvironment, developmentRuntimeLibraries, developmentRuntimeTools, developmentSandbox } from '../public/jarvis-development.mjs';

if (process.platform !== 'darwin') {
  console.log('Native loopback diagnostics require macOS; no probe executed.');
} else {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jarvis-loopback-diagnostic-')));
  try {
    for (const name of ['home', 'tmp', 'data']) await mkdir(join(root, name));
    const executable = await realpath(process.execPath);
    const libraries = await developmentRuntimeLibraries(), tools = await developmentRuntimeTools();
    for (let attempt = 0; attempt < 4; attempt++) {
      const reservation = net.createServer();
      let port;
      for (let retry = 0; retry < 10; retry++) {
        port = randomInt(16000, 32001);
        try {
          await new Promise((resolve, reject) => {
            reservation.once('error', error => { reservation.removeAllListeners('listening'); reject(error); });
            reservation.once('listening', () => { reservation.removeAllListeners('error'); resolve(); });
            reservation.listen(port, '127.0.0.1');
          });
          await new Promise(resolve => reservation.close(resolve));
          break;
        } catch (error) { if (error.code !== 'EADDRINUSE' || retry === 9) throw error; }
      }
      for (const address of ['localhost', '127.0.0.1']) {
        const profile = join(root, `probe-${attempt}-${address}.sb`);
        const policy = developmentSandbox(root, join(root, 'data'), [port], executable, libraries, tools).replaceAll('localhost:', `${address}:`);
        await writeFile(profile, policy, { mode: 0o600 });
        const source = `import http from 'node:http';
const server=http.createServer((request,response)=>response.end('synthetic-loopback'));
server.on('error',error=>{console.error(JSON.stringify({stage:'listen',code:error.code,port:${port}}));process.exitCode=1;});
server.listen(${port},'127.0.0.1',async()=>{try{const response=await fetch('http://127.0.0.1:${port}');if(await response.text()!=='synthetic-loopback')throw Error('unexpected_response');console.log('synthetic-loopback-ready');}catch(error){console.error(JSON.stringify({stage:'fetch',code:error.cause?.code??error.code??error.message}));process.exitCode=1;}finally{server.closeAllConnections();server.close();}});`;
        const result = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, executable, '--input-type=module', '-e', source], { cwd: root, env: developmentEnvironment(root, port), timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 16_000 });
        console.log(JSON.stringify({ diagnostic: 'native-loopback-address', node: process.version, attempt, address, port, status: result.status, signal: result.signal, error: result.error?.code, stdout: result.stdout?.slice(-1500), stderr: result.stderr?.slice(-1500) }));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
