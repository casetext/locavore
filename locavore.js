var fs = require('fs'),
	path = require('path'),
	events = require('events'),
	util = require('util'),
	singleTenancy = require('./tenancy/single'),
	multiTenancy = require('./tenancy/multi'),
	child_process = require('child_process'),
	Comms = require('comms'),
	cpus = require('os').cpus().length,
	colors = require('colors');

var taskid = 0;

function Locavore(opts) {
	var self = this;
	events.EventEmitter.call(this);

	this.functions = {};
	this.watchers = [];
	this.completed = 0;
	this.errors = 0;
	this.debug = false;
	this.nextSend = {};
	this.opts = opts;
	this.comms = Comms();

	if (typeof opts.verbosity != 'number' || !isFinite(opts.verbosity)) {
		opts.verbosity = 4;
	}

	if (opts.debug) {
		this.debug = true;
		opts.maxWorkers = 1;
		opts.maxPerProcess = 1;
		this.tenant = singleTenancy;
	} else {
		if (opts.maxPerProcess > 1) {
			this.tenant = multiTenancy;
		} else {
			this.tenant = singleTenancy;
		}
	}

	opts.folder = path.resolve(process.cwd(), opts.folder);


	this.comms.on('connection', function(socket) {
		self.stats(function(err, stats) {
			socket.send('init', { debug: self.debug });
			socket.send('queue', { stats:stats });
		});
	});


	this.init();

}
util.inherits(Locavore, events.EventEmitter);

Locavore.prototype.init = function() {
	var self = this, opts = this.opts;

	fs.readdirSync(opts.folder).forEach(function(fn) {
		try {
			var oldStats = self.functions[fn] && self.functions[fn].stats;
			if (fn != 'node_modules' && fs.statSync(path.join(opts.folder, fn)).isDirectory()) {
				self.functions[fn] = JSON.parse(fs.readFileSync(path.join(opts.folder, fn, 'package.json')));
				self.functions[fn].path = path.join(opts.folder, fn);
				self.functions[fn].stats = oldStats || {
					runs: 0,
					errors: 0,
					time: 0,
					mem: 0
				};

				self.watchers.push(fs.watch(self.functions[fn].path, needReload));
			}
		} catch(ex) {
			if (opts.verbosity >= 1) {
				console.error('Could not read metadata for function'.yellow, fn, ex);
			}
		}
	});


	self.pool = self.tenant.getPool(opts);

	var doom;

	function needReload() {
		if (!doom) {
			if (opts.verbosity >= 1) {
				console.log(now('locavore'.bgGreen), 'Change to function detected, reloading...');
			}
			doom = setTimeout(function() {
				var oldPool = self.pool;
				self.init();
				oldPool.drain(function() {
					if (opts.verbosity >= 1) {
						console.log(now('locavore'.bgGreen), 'Drained old worker pool');
					}
					oldPool.destroyAllNow();
					oldPool = null;
				});

			}, 200);
			clearWatchers();
		}
	}
};

Locavore.prototype.invoke = function(fn, data, acceptanceCb, completionCb) {
	var self = this;
	if (self.opts.prefix instanceof RegExp) {
		var match = self.opts.prefix.exec(fn);
		if (match) {
			fn = fn.substr(match[0].length);
		}
	}

	var meta = self.functions[fn], id = ++taskid, myPool = self.pool, maxRuntime, timeout;
	if (meta) {
		myPool.acquire(function(err, proc) {
			if (err) {
				done(err);
			} else {
				self.sendQueueStats();
				proc.invokeid = id;
				proc.once('done', release);
				if (self.opts.verbosity >= 4) {
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

				if (!self.debug) {
					timeout = setTimeout(revoke, maxRuntime * 1000);
				}

			}

			function release(err, result) {
				clearTimeout(timeout);
				done(err, result);
				if (self.debug) {
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
				self.completed++;
				meta.stats.runs++;
				if (err) {
					self.errors++;
					meta.stats.errors++;
				}
				if (err && err._exception) {
					err = err._exception;
				}
				if (result) {
					meta.stats.time += result.ms;
					meta.stats.mem += result.memBytes;
				}
				if (self.opts.verbosity >= 4 || (self.opts.verbosity >= 2 && err)) {
					console.log(now(id), (err ? 'ERROR'.bgRed : 'END') + ' ' + fn + '  Duration: '.gray + ((result && result.time) || '-') + '  Memory Estimate*: '.gray + ((result && result.mem) || '-'));
					console.log((err && err.stack) || err, result && result.returnValue || '');
				}
				self.sendQueueStats();
				self.sendFnStats(fn);
				if (completionCb) {
					completionCb(err, result && result.returnValue);
				}
			}
		});

		self.sendQueueStats();
		if (acceptanceCb) {
			acceptanceCb(null, id); // Immediately return success.
			      // If there are no available workers, `acquire` queues the request until one becomes available.
		}
	} else {
		if (self.opts.verbosity >= 1) {
			console.warn(now(id), 'WARN'.bgYellow + ' Could not find function '.yellow + fn);
		}
		if (acceptanceCb) {
			acceptanceCb(new Error('Function not found.'));
		}
	}

};

Locavore.prototype.functionList = function(cb) {
	var result = [];
	for (var fn in this.functions) {
		result.push({
			FunctionName: fn
		});
	}
	cb(null, result);
};

Locavore.prototype.stats = function(cb) {
	cb(null, {
		workers: this.pool && this.pool.getPoolSize(),
		avail: this.pool && this.pool.availableObjectsCount(),
		queued: this.pool && this.pool.waitingClientsCount(),
		done: this.completed,
		errors: this.errors
	});
};

Locavore.prototype.resetStats = function() {
	this.completed = 0;
	this.errors = 0;
};

Locavore.prototype.drain = function(cb) {
	this.pool.drain(cb);
};

Locavore.prototype.clearWatchers = function() {
	this.watchers.forEach(function(watcher) {
		watcher.close();
	});
	this.watchers = [];
};

Locavore.prototype.shutdown = function() {
	this.clearWatchers();
	this.pool.destroyAllNow();
};


Locavore.prototype.listenForMonitor = function(port) {
	this.comms.listen(port || 3034);
};

Locavore.prototype.closeMonitor = function(cb) {
	this.comms.close(cb);
};


Locavore.prototype.sendQueueStats = function() {
	var self = this;
	if (!self.nextSend['*queue']) {
		self.nextSend['*queue'] = setTimeout(function() {
			
			self.nextSend['*queue'] = null;
			self.stats(function(err, stats) {
				self.comms.send('queue', { stats:stats });
			});

		}, 100);
	}
};

Locavore.prototype.sendFnStats = function(fn) {
	var self = this;
	if (!self.nextSend[fn]) {
		self.nextSend[fn] = setTimeout(function() {
			
			self.nextSend[fn] = null;
			self.comms.send('fn', { name:fn, stats:self.functions[fn].stats });

		}, 100);
	}
};


function now(id) {
	return '['.gray + id + ' ' + new Date().toISOString().gray + ']'.gray;
}

exports = module.exports = Locavore;
