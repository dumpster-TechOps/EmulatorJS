import { spawn } from 'child_process';
import { resolve } from 'path';

// Launch a child process and forward stdio so output is visible. Log
// start/end events and surface spawn errors for easier debugging.
function run(cmd, args) {
  console.log(`Starting ${cmd} ${args.join(' ')}`.trim());
  const child = spawn(cmd, args, { stdio: 'inherit' });
  child.on('error', err => {
    console.error(`Failed to start ${cmd}:`, err);
  });
  child.on('close', code => {
    if (code && code !== 0) {
      console.error(`${cmd} exited with code ${code}`);
    } else {
      console.log(`${cmd} exited`);
    }
  });
  return child;
}

const procs = [];
procs.push(run('http-server', []));
procs.push(run('node', [resolve('server', 'netplay-server.js')]));

// Terminate all spawned processes on shutdown signals.
function shutDown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  for (const p of procs) {
    p.kill(signal);
  }
}
process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));

