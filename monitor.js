var dgram = require('dgram'),
	charm = require('charm')(),
	colors = require('colors'),
	bytes = require('bytes'),
	consoleTitle = require('console-title');

var sock = dgram.createSocket('udp4');
sock.on('error', console.error);
sock.bind(3033, '127.0.0.1', function(err) {
	if (err) {
		console.error('Could not bind to port.'.red);
		process.exit(1);
	} else {
		init();
	}
});

sock.on('message', function(msg) {
	try {
		msg = JSON.parse(msg.toString());

	} catch(ex) {

	}

	if (msg.type == 'queue') {
		queueStats(msg.stats);
	} else if (msg.type == 'fn') {
		fnStats(msg.name, msg.stats);
	} else if (msg.type == 'start') {
		reset();
	} else if (msg.type == 'stop') {
		charm.position(70, 1).write('stopped'.bgRed);
		bot();
	}
});

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


function queueStats(stats) {
	charm.position(9, 2).write(''+stats.queued + '       ');
	charm.position(30, 2).write(stats.avail + ' / ' + stats.workers + '    ');
	charm.position(55, 2).write(''+stats.done);
	bot();
}


var fnLine = {}, nextFnLine = 6;
function fnStats(fn, stats) {
	if (!fnLine[fn]) {
		fnLine[fn] = nextFnLine++;
	}

	var y = fnLine[fn];

	charm.position(0, y).erase('end').write(fn.substr(0, 41));
	charm.position(42, y).write(''+stats.runs);
	charm.position(49, y).write(''+stats.errors);
	charm.position(58, y).write(''+Math.round((stats.time / stats.runs) * 10) / 10);
	charm.position(68, y).write(bytes(stats.mem / stats.runs));
	bot();
}

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