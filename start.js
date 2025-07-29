import { spawn } from 'child_process';
import { resolve } from 'path';

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit' });
  child.on('close', code => {
    if (code && code !== 0) {
      console.error(`${cmd} exited with code ${code}`);
    }
  });
  return child;
}

const procs = [];
procs.push(run('http-server', []));
procs.push(run('node', [resolve('server', 'netplay-server.js')]));

function shutDown(signal) {
  for (const p of procs) {
    p.kill(signal);
  }
}
process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));

