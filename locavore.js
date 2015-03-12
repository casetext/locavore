var fs = require('fs'),
	dgram = require('dgram'),
	path = require('path'),
	singleTenancy = require('./tenancy/single'),
	multiTenancy = require('./tenancy/multi'),
	child_process = require('child_process'),
	cpus = require('os').cpus().length,
	colors = require('colors');

var functions = {}, watchers = [], pool, currentOpts, taskid=0, completed=0, errors=0, debug=false;

exports.init = function(opts) {

	var tenant;

	if (typeof opts.verbosity != 'number' || !isFinite(opts.verbosity)) {
		opts.verbosity = 4;
	}

	if (opts.debug) {
		debug = true;
		opts.maxWorkers = 1;
		opts.maxPerProcess = 1;
		tenant = singleTenancy;
		send({type:'debugging'});
	} else {
		if (opts.maxPerProcess > 1) {
			tenant = multiTenancy;
		} else {
			tenant = singleTenancy;
		}
	}
	currentOpts = opts;

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
			if (opts.verbosity >= 1) {
				console.error('Could not read metadata for function'.yellow, fn, ex);
			}
		}
	});


	pool = tenant.getPool(opts);

	var doom;
	function needReload() {
		if (!doom) {
			if (opts.verbosity >= 1) {
				console.log(now('locavore'.bgGreen), 'Change to function detected, reloading...');
			}
			doom = setTimeout(function() {
				var oldPool = pool;
				exports.init(opts);
				oldPool.drain(function() {
					if (opts.verbosity >= 1) {
						console.log(now('locavore'.bgGreen), 'Drained old worker pool');
					}
					oldPool.destroyAllNow();
					oldPool = null;
				});

			}, 200);
			watchers.forEach(function(watcher) {
				watcher.close();
			});
			watchers = [];
		}
	}

};

function now(id) {
	return '['.gray + id + ' ' + new Date().toISOString().gray + ']'.gray;
}

exports.invoke = function(fn, data, cb) {
	var meta = functions[fn], id = ++taskid, myPool = pool, maxRuntime, timeout;
	if (meta) {
		myPool.acquire(function(err, proc) {
			if (err) {
				done(err);
			} else {
				// sendQueueStats();
				proc.invokeid = id;
				proc.once('done', release);
				if (currentOpts.verbosity >= 4) {
					console.log(now(id), 'START', fn, ('on ' + proc.pid).gray);
				}
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
				done(err, result);
				if (debug) {
					proc.destroy();
					myPool.destroy(proc);
				} else {
					proc.invokeid = null;
					proc.removeListener('done', release);
					myPool.release(proc);
				}
			}

			function revoke() {
				done('Function timed out after ' + maxRuntime + ' seconds; killed ' + proc.pid + '.');
				if (proc.reap) {
					proc.reap();
				}
				myPool.destroy(proc);
			}

			function done(err, result) {
				completed++;
				meta.stats.runs++;
				if (err) {
					errors++;
					meta.stats.errors++;
				}
				if (result) {
					meta.stats.time += result.ms;
					meta.stats.mem += result.memBytes;
				}
				if (currentOpts.verbosity >= 4 || (currentOpts.verbosity >= 2 && err)) {
					console.log(now(id), (err ? 'ERROR'.bgRed : 'END') + ' ' + fn + '  Duration: '.gray + ((result && result.time) || '-') + '  Memory Estimate*: '.gray + ((result && result.mem) || '-'));
					if (err && err._exception) {
						err = err._exception.stack;
					}
					console.log(err, result && result.returnValue || '');
				}
				// sendQueueStats();
				// sendFnStats(fn);
			}
		});

		// sendQueueStats();
		cb(null, id); // Immediately return success.
		      // If there are no available workers, `acquire` queues the request until one becomes available.
	} else {
		if (currentOpts.verbosity >= 1) {
			console.warn(now(id), 'WARN'.bgYellow + ' Could not find function '.yellow + fn);
		}
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
		done: completed,
		errors: errors
	});
};

exports.resetStats = function() {
	completed = 0;
	errors = 0;
};

exports.drain = function(cb) {
	pool.drain(cb);
};

exports.shutdown = function() {
	watchers.forEach(function(watcher) {
		watcher.close();
	});
	pool.destroyAllNow();
};

/*
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
});*/