var fs = require('fs'),
	dgram = require('dgram'),
	path = require('path'),
	Pool = require('generic-pool').Pool,
	child_process = require('child_process'),
	cpus = require('os').cpus().length,
	colors = require('colors');

var functions = {}, pool, taskid=0, completed=0, debug=false;

exports.init = function(opts) {

	var watchers = [];

	if (opts.debug) {
		debug = true;
		opts.maxWorkers = 1;
		send({type:'debugging'});
	}

	fs.readdirSync(opts.folder).forEach(function(fn) {
		try {
			var oldStats = functions[fn] && functions[fn].stats;
			if (fn != 'node_modules' && fs.statSync(path.join(opts.folder, fn)).isDirectory()) {
				functions[fn] = JSON.parse(fs.readFileSync(path.join(opts.folder, fn, 'package.json')));
				functions[fn].path = path.join(opts.folder, fn);
				functions[fn].stats = oldStats || {
					runs: 0,
					errors: 0,
					time: 0,
					mem: 0
				};

				watchers.push(fs.watch(functions[fn].path, needReload));
			}
		} catch(ex) {
			console.error('Could not read metadata for function'.yellow, fn, ex);
		}
	});


	pool = Pool({
		name: 'LambdaPool',
		create: function(cb) {
			var proc = child_process.fork(__dirname + '/worker.js', [], {
				silent: true,
				execArgv: debug ? ['--debug-brk'] : []
			});
			if (!debug) {
				var timeout = setTimeout(function() {
					oops(new Error('Timed out waiting for worker process to get ready.'));
				}, 30000);
			}
			proc.once('error', oops);
			proc.once('message', function(msg) {
				if (msg.ready) {
					clearTimeout(timeout);
					proc.removeListener('error', oops);
					proc.on('error', function(err) {
						console.error(now(proc.invokeid), 'Strange worker proc error'.red, err);
					});
					cb(null, proc);
				}
			});
			proc.stdout.on('data', function(data) {
				process.stdout.write(now(proc.invokeid).bgBlue + ' ' + data);
			});
			proc.stderr.on('data', function(data) {
				process.stdout.write(now(proc.invokeid).bgRed + ' ' + data);
			});

			function oops(err) {
				clearTimeout(timeout);
				cb(err);
			}
		},
		destroy: function(proc) {
			proc.kill();
			sendQueueStats();
		},
		validate: function(proc) {
			return proc.connected;
		},
		max: opts.maxWorkers || cpus * 2
	});


	var doom;
	function needReload() {
		if (!doom) {
			console.log(now('locavore'.bgGreen), 'Change to function detected, reloading...');
			doom = setTimeout(function() {
				var oldPool = pool;
				exports.init(opts);
				oldPool.drain(function() {
					console.log(now('locavore'.bgGreen), 'Drained old worker pool');
					oldPool.destroyAllNow();
					oldPool = null;
				});

			}, 200);
			watchers.forEach(function(watcher) {
				watcher.close();
			});
		}
	}

};

function now(id) {
	return '['.gray + id + ' ' + new Date().toISOString().gray + ']'.gray;
}

exports.invoke = function(fn, data, cb) {
	var meta = functions[fn], id = taskid++, myPool = pool, maxRuntime, timeout;
	if (meta) {
		myPool.acquire(function(err, proc) {
			if (err) {
				done(err);
			} else {
				sendQueueStats();
				proc.invokeid = id;
				proc.once('exit', function(code) {
					release(new Error('Worker exited with code ' + code));
				});
				proc.once('error', release);
				proc.once('message', function(msg) {
					release(msg.err, msg);
				});
				console.log(now(id), 'START', fn);
				proc.send({
					path: meta.path,
					fn: meta.lambdaFunction || 'handler',
					data: data,
					id: id
				});

				maxRuntime = Math.round(meta.timeout) || 3;
				if (maxRuntime < 1) {
					maxRuntime = 1;
				} else if (maxRuntime > 60) {
					maxRuntime = 60;
				}

				if (!debug) {
					timeout = setTimeout(revoke, maxRuntime * 1000);
				}

			}

			function release(err, result) {
				clearTimeout(timeout);
				if (debug) {
					proc.removeAllListeners();
					proc.kill();
					myPool.destroy(proc);
				} else {
					proc.invokeid = null;
					proc.removeListener('error', release);
					proc.removeAllListeners('exit');
					proc.removeAllListeners('message');
					myPool.release(proc);
				}
				done(err, result);
			}

			function revoke() {
				proc.removeAllListeners();
				proc.kill();
				myPool.destroy(proc);
				done('Function timed out after ' + maxRuntime + ' seconds; killed.');
			}

			function done(err, result) {
				completed++;
				meta.stats.runs++;
				if (err) {
					meta.stats.errors++;
				}
				if (result) {
					meta.stats.time += result.ms;
					meta.stats.mem += result.memBytes;
				}
				console.log(now(id), (err ? 'ERROR'.bgRed : 'END') + ' ' + fn + '  Duration: '.gray + ((result && result.time) || '-') + '  Memory Estimate*: '.gray + ((result && result.mem) || '-'));
				if (err && err._exception) {
					err = err._exception.stack;
				}
				console.log(err, result && result.returnValue || '');
				sendQueueStats();
				sendFnStats(fn);
			}
		});

		sendQueueStats();
		cb(null, id); // Immediately return success.
		      // If there are no available workers, `acquire` queues the request until one becomes available.
	} else {
		console.warn(now(id), 'WARN'.bgYellow + ' Could not find function '.yellow + fn);
		cb(new Error('Function not found.'));
	}

};

exports.functionList = function(cb) {
	var result = [];
	for (var fn in functions) {
		result.push({
			FunctionName: fn
		});
	}
	cb(null, result);
};

exports.stats = function(cb) {
	cb(null, {
		workers: pool && pool.getPoolSize(),
		avail: pool && pool.availableObjectsCount(),
		queued: pool && pool.waitingClientsCount(),
		done: completed
	});
};


exports.drain = function(cb) {
	pool.drain(cb);
};


var udp = dgram.createSocket('udp4'), nextSend = {};
function send(obj, cb) {
	obj = new Buffer(JSON.stringify(obj));
	udp.send(obj, 0, obj.length, 3033, '127.0.0.1', cb);
}
function sendQueueStats() {
	if (!nextSend['*queue']) {
		nextSend['*queue'] = setTimeout(function() {
			
			nextSend['*queue'] = null;
			exports.stats(function(err, stats) {
				send({type:'queue', stats:stats});
			});

		}, 100);
	}
}

function sendFnStats(fn) {
	if (!nextSend[fn]) {
		nextSend[fn] = setTimeout(function() {
			
			nextSend[fn] = null;
			send({type:'fn', name:fn, stats:functions[fn].stats});

		}, 100);
	}
}
send({type:'start'});
sendQueueStats();


process.on('SIGINT', function() {
	send({type:'stop'}, function() {
		process.exit(0);
	});
});