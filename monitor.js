#!/usr/bin/env node

var comms = require('comms')(),
	charm = require('charm')(),
	colors = require('colors'),
	bytes = require('bytes'),
	consoleTitle = require('console-title'),
	argv = require('yargs')
		.alias('p','port').default('p', 3034).describe('p', 'Connect to this port')
		.alias('h','host').default('h', '127.0.0.1').describe('h', 'Connect to this host')
		.help('help').usage('Usage: $0')
		.argv;



function init() {
	consoleTitle('locavore monitor');
	charm.pipe(process.stdout);
	charm.reset();
	charm.write('locavore monitor'.bgBlue + '\n');
	charm.write('Queued:             Workers:                    Done: \n\n'.gray);
	charm.write('Function                                 Runs   Errors   Avg Time  Avg Mem\n');
	charm.write('================================================================================\n'.gray);
	bot();
}
init();

comms.on('init', function(msg) {
	reset();
	if (msg.debug) {
		charm.position(70, 1).write('debug!!'.bgMagenta);
		bot();
	}
});

comms.on('disconnected', function() {
	charm.position(70, 1).write('stopped'.bgRed);
	bot();
});

function queueStats(stats) {
	charm.position(9, 2).write(''+stats.queued + '       ');
	charm.position(30, 2).write(stats.avail + ' / ' + stats.workers + '    ');
	charm.position(55, 2).write(''+stats.done);
	bot();
}

comms.on('queue', function(msg) {
	queueStats(msg.stats);
});

var fnLine = {}, nextFnLine = 6;

comms.on('fn', function(msg) {
	if (!fnLine[msg.name]) {
		fnLine[msg.name] = nextFnLine++;
	}

	var y = fnLine[msg.name];

	charm.position(0, y).erase('end').write(msg.name.substr(0, 41));
	charm.position(42, y).write(''+msg.stats.runs);
	charm.position(49, y).write(''+msg.stats.errors);
	charm.position(58, y).write(''+Math.round((msg.stats.time / msg.stats.runs) * 10) / 10);
	charm.position(68, y).write(msg.stats.mem ? bytes(msg.stats.mem / msg.stats.runs) : '-'.gray);
	bot();
});

function reset() {
	queueStats({queued: '     ', avail:'  ', workers:'  ', done:'      '});
	charm.position(70, 1).write('running'.bgGreen);
	charm.position(0, 6).erase('down');
	nextFnLine = 6;
	fnLine = {};
}

function bot() {
	charm.position(0, process.stdout.rows);
}


comms.connect(argv.port, argv.host);
