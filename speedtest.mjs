import dgram from 'dgram';
import net from 'net';
import crypto from 'crypto';

const PEER_TIMEOUT = 10000;
const DISCOVERY_PORT = 41000;
const TRANSFER_PORT = 41001;

let peers = []; // Array of string IPs
let selectedIndex = -1;
let lastSeen = new Map(); // IP -> timestamp

let mode = 'idle'; // 'idle', 'upload', 'download', 'duplex', 'custom'
let customIpBuffer = '';
let activeSockets = [];
let remotePeerIp = '';

let stats = {
	upBytes: 0,
	downBytes: 0,
	startTime: 0,
	lastUpBytes: 0,
	lastDownBytes: 0,
	upSpeed: 0, // bytes/sec
	downSpeed: 0 // bytes/sec
};

let speedInterval;

// UDP Discovery
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
	udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
	if (msg.toString() === 'SPEEDTEST_PING') {
		const ip = rinfo.address;
		lastSeen.set(ip, Date.now());
		if (!peers.includes(ip)) {
			peers.push(ip);
			if (selectedIndex === -1) selectedIndex = 0;
			render();
		}
	}
});

udpServer.on('listening', () => {
	udpServer.setBroadcast(true);
});
udpServer.bind(DISCOVERY_PORT);

setInterval(() => {
	const msg = Buffer.from('SPEEDTEST_PING');
	try {
		udpServer.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255', (err) => { });
	} catch (e) {
		// Ignore send error
	}

	const now = Date.now();
	let changed = false;
	for (let i = peers.length - 1; i >= 0; i--) {
		const ip = peers[i];
		if (now - (lastSeen.get(ip) || 0) > PEER_TIMEOUT) {
			peers.splice(i, 1);
			changed = true;
			if (selectedIndex >= peers.length) selectedIndex = Math.max(-1, peers.length - 1);
		}
	}
	if (changed) render();
}, 2000);

// TCP Server
const tcpServer = net.createServer((socket) => {
	socket.once('data', (data) => {
		const cmd = data.toString('utf8', 0, 1);
		handleServerConnection(socket, cmd);
	});
	socket.on('error', () => { });
});

function handleServerConnection(socket, cmd) {
	activeSockets.push(socket);
	remotePeerIp = socket.remoteAddress || '';
	if (remotePeerIp.startsWith('::ffff:')) {
		remotePeerIp = remotePeerIp.replace('::ffff:', '');
	}

	stats = { upBytes: 0, downBytes: 0, startTime: Date.now(), lastUpBytes: 0, lastDownBytes: 0, upSpeed: 0, downSpeed: 0 };

	if (cmd === 'U') {
		mode = 'receiving upload (downloading)';
		socket.on('data', (chunk) => { stats.downBytes += chunk.length; });
	} else if (cmd === 'D') {
		mode = 'serving download (uploading)';
		pumpData(socket, true);
	} else if (cmd === 'X') {
		mode = 'serving duplex';
		socket.on('data', (chunk) => { stats.downBytes += chunk.length; });
		pumpData(socket, true);
	}

	socket.on('error', () => {
		stopTest(false);
	});
	socket.on('close', () => {
		stopTest(false);
	});

	if (speedInterval) clearInterval(speedInterval);
	speedInterval = setInterval(() => {
		stats.upSpeed = stats.upBytes - stats.lastUpBytes;
		stats.downSpeed = stats.downBytes - stats.lastDownBytes;
		stats.lastUpBytes = stats.upBytes;
		stats.lastDownBytes = stats.downBytes;
		render();
	}, 1000);

	render();
}

tcpServer.listen(TRANSFER_PORT);

const dummyData = crypto.randomBytes(64 * 1024);

function pumpData(socket, isUploadStat = false) {
	function write() {
		let ok = true;
		while (ok) {
			if (socket.destroyed) break;
			ok = socket.write(dummyData, () => {
				if (isUploadStat) stats.upBytes += dummyData.length;
			});
			if (!ok) break;
		}
	}
	socket.on('drain', write);
	socket.on('error', () => { });
	socket.on('close', () => { });
	write();
}

function startTest(testMode) {
	if (selectedIndex < 0 || selectedIndex >= peers.length) return;
	const ip = peers[selectedIndex];
	mode = testMode;
	stats = { upBytes: 0, downBytes: 0, startTime: Date.now(), lastUpBytes: 0, lastDownBytes: 0, upSpeed: 0, downSpeed: 0 };

	const socket = net.createConnection({ port: TRANSFER_PORT, host: ip }, () => {
		activeSockets.push(socket);

		if (testMode === 'upload' || testMode === 'duplex') {
			socket.write(testMode === 'upload' ? 'U' : 'X');
			pumpData(socket, true);
		} else if (testMode === 'download') {
			socket.write('D');
		}
	});

	if (testMode === 'download' || testMode === 'duplex') {
		socket.on('data', (chunk) => {
			stats.downBytes += chunk.length;
		});
	}

	socket.on('error', () => {
		stopTest(false);
	});
	socket.on('close', () => {
		stopTest(false);
	});

	if (speedInterval) clearInterval(speedInterval);
	speedInterval = setInterval(() => {
		stats.upSpeed = stats.upBytes - stats.lastUpBytes;
		stats.downSpeed = stats.downBytes - stats.lastDownBytes;
		stats.lastUpBytes = stats.upBytes;
		stats.lastDownBytes = stats.downBytes;
		render();
	}, 1000);

	render();
}

function stopTest(userInitiated = true) {
	activeSockets.forEach(s => s.destroy());
	activeSockets = [];
	mode = 'idle';
	if (speedInterval) clearInterval(speedInterval);
	render();
}

function formatSpeed(bytesPerSec) {
	if (bytesPerSec === 0) return '0 B/s';
	const k = 1000;
	const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
	const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
	return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(3)) + ' ' + sizes[i];
}

function render() {
	process.stdout.write('\x1b[2J\x1b[H');
	console.log('=== NodeJS Speedtest P2P ===\n');

	if (mode === 'custom') {
		console.log('Enter Custom IP (Press Enter to confirm, Esc to cancel):');
		console.log('> ' + customIpBuffer);
		return;
	}

	console.log('Discovered Peers:');
	if (peers.length === 0) {
		console.log('  No peers found yet...');
	} else {
		peers.forEach((peer, i) => {
			if (i === selectedIndex) {
				console.log(`\x1b[47m\x1b[30m> ${peer}\x1b[0m`); // Highlight background white, text black
			} else {
				console.log(`  ${peer}`);
			}
		});
	}

	console.log('\nControls:');
	console.log('  \u2191/\u2193 : Select Peer  |  c : Custom IP');
	console.log('  u : Upload Test  |  d : Download Test  |  x : Duplex Test');
	console.log('  q : Stop Test / Quit\n');

	if (mode !== 'idle') {
		const ip = (mode.startsWith('receiving') || mode.startsWith('serving')) ? remotePeerIp : peers[selectedIndex];
		console.log(`[ACTIVE] Mode: ${mode.toUpperCase()} with ${ip}`);
		console.log(`  Upload:   ${formatSpeed(stats.upSpeed)}`);
		console.log(`  Download: ${formatSpeed(stats.downSpeed)}`);
	} else {
		console.log('[IDLE] Select a peer and press u, d, or x to start.');
	}
}

// Input Handling
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', (key) => {
	if (key === '\u0003') { // Ctrl+C
		process.exit();
	}

	if (mode === 'custom') {
		if (key === '\r' || key === '\n') {
			if (customIpBuffer) {
				if (!peers.includes(customIpBuffer)) {
					peers.push(customIpBuffer);
					lastSeen.set(customIpBuffer, Date.now() + 31536000000);
				}
				selectedIndex = peers.indexOf(customIpBuffer);
			}
			mode = 'idle';
			customIpBuffer = '';
			render();
		} else if (key === '\x1b' || key === '\u001b') {
			mode = 'idle';
			customIpBuffer = '';
			render();
		} else if (key === '\b' || key === '\x7f') { // Backspace
			customIpBuffer = customIpBuffer.slice(0, -1);
			render();
		} else if (/^[0-9.]$/.test(key)) {
			customIpBuffer += key;
			render();
		}
		return;
	}

	if (key === 'q') {
		if (mode !== 'idle') {
			stopTest();
		} else {
			process.exit();
		}
		return;
	}

	if (mode === 'idle') {
		if (key === '\u001b[A') { // Up arrow
			if (selectedIndex > 0) selectedIndex--;
			render();
		} else if (key === '\u001b[B') { // Down arrow
			if (selectedIndex < peers.length - 1) selectedIndex++;
			render();
		} else if (key === 'c') {
			mode = 'custom';
			customIpBuffer = '';
			render();
		} else if (key === 'u' || key === 'd' || key === 'x') {
			const modeMap = { u: 'upload', d: 'download', x: 'duplex' };
			startTest(modeMap[key]);
		}
	}
});

render();
