const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const apiPort = Number(process.env.BOOKING_API_PORT || 7071);
const webPort = Number(process.env.BOOKING_WEB_PORT || 4281);
const inspectPort = Number(process.env.BOOKING_INSPECT_PORT || 9229);
const children = [];
let stopping = false;

function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children.reverse()) {
        if (child.exitCode !== null) continue;
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        } else {
            try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
                if (error.code !== 'ESRCH') console.error(error.message);
            }
        }
    }
    process.exit(code);
}

function listening(port) {
    return new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port });
        const finish = result => { socket.destroy(); resolve(result); };
        socket.setTimeout(500);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
    });
}

function start(command, args, cwd, env = process.env) {
    const windows = process.platform === 'win32';
    const child = windows
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command}.cmd ${args.join(' ')}`], { cwd, env, stdio: 'inherit' })
        : spawn(command, args, { cwd, env, stdio: 'inherit', detached: true });
    children.push(child);
    child.once('error', error => {
        console.error(`Cannot start ${command}: ${error.message}`);
        stop(1);
    });
    child.once('exit', code => {
        if (!stopping) {
            console.error(`${command} stopped; shutting down local debugging.`);
            stop(code || 1);
        }
    });
}

async function waitFor(port) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (await listening(port)) return;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Local service on port ${port} did not start within 90 seconds.`);
}

async function main() {
    const ports = [apiPort, webPort, inspectPort];
    if (new Set(ports).size !== 3 || ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) {
        throw new Error('Debug ports must be distinct integers between 1024 and 65535.');
    }
    for (const port of ports) {
        if (await listening(port)) {
            throw new Error(`Port ${port} is already in use. Stop the existing API/frontend task or debug session, then press F5 again.`);
        }
    }
    if (process.argv.includes('--check')) {
        console.log('Debug ports are available.');
        return;
    }
    start('func', ['start', '--port', String(apiPort)], path.join(root, 'api'), {
        ...process.env,
        languageWorkers__node__arguments: `--inspect=127.0.0.1:${inspectPort}`
    });
    await waitFor(apiPort);
    await waitFor(inspectPort);
    start('swa', ['start', 'app', '--api-devserver-url', `http://localhost:${apiPort}`, '--swa-config-location', 'app', '--port', String(webPort)], root);
    await waitFor(webPort);
    const response = await fetch(`http://localhost:${webPort}/`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Frontend startup returned HTTP ${response.status}.`);
    console.log(`BOOKING_READY http://localhost:${webPort}`);
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
main().catch(error => { console.error(error.message); stop(1); });