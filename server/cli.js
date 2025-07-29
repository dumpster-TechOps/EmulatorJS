#!/usr/bin/env node
import { program } from 'commander';
import { startServer } from './netplay-server.js';

program
  .option('-p, --port <port>', 'port to listen on')
  .option('--jwt-secret <secret>', 'jwt secret')
  .option('--ice <json>', 'ICE servers JSON')
  .option('--allowed-domains <list>', 'comma separated allowed domains');

program.parse(process.argv);
const opts = program.opts();
if (opts.port) process.env.PORT = opts.port;
if (opts.jwtSecret) process.env.JWT_SECRET = opts.jwtSecret;
if (opts.ice) process.env.ICE_SERVERS = opts.ice;
if (opts.allowedDomains) process.env.ALLOWED_DOMAINS = opts.allowedDomains;

startServer();
