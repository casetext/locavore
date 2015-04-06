var spawner = require('./spawner'),
	cpus = require('os').cpus().length,
	path = require('path'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	Pool = require('generic-pool').Pool;


exports.getPool = function(opts) {
	if (opts.debug) {
		throw new Error('The multitenant pool does not support debug mode.');
	}
	opts.maxWorkers = opts.maxWorkers || (cpus * 2);

	var shallow = {}, procCount = 0, createQueue = [];


	function create(cb) {
		for (var pid in shallow) {
			if (!shallow[pid].reap) {
				cb(null, new MultiplexedProcess(shallow[pid]));
				return;
			}
		}

		if (procCount < opts.maxWorkers) {
			procCount++;
			spawner.getProcess(opts, function(err, proc) {
				if (err) {
					procCount--;
					cb(err);
				} else {
					proc.invokeid = '<' + proc.pid + '>';
					proc.multiplexCount = 0;
					proc.invoking = {};
					cb(null, new MultiplexedProcess(proc));

					var retry = createQueue;
					createQueue = [];
					retry.forEach(create);
				}
			});
		} else {
			createQueue.push(cb);
		}
	}

	function MultiplexedProcess(proc) {
		proc.multiplexCount++;
		this.pid = proc.pid;

		if (proc.multiplexCount < opts.maxPerProcess) {
			shallow[proc.pid] = proc;
		} else {
			delete shallow[proc.pid];
		}

		proc.setMaxListeners(opts.maxPerProcess); // Avoid complaints when maxPerProcess > 10

		this.process = proc;
	}
	util.inherits(MultiplexedProcess, EventEmitter);

	MultiplexedProcess.prototype.send = function(args) {
		var self = this;
		this.process.on('done', done);
		args.multi = true;
		this.process.invoking[args.id] = true;
		this.process.send(args);

		function done(err, result) {
			if (result && result.id) {
				if (result.id == args.id) {
					if (!self.process.invoking[args.id]) return;
					delete self.process.invoking[args.id];

					if (self.process.reap && Object.keys(self.process.invoking).length == 0) {
						self.process.destroy();
					}

					self.process.removeListener('done', done);
					self.emit('done', err, result);
				}
			} else {
				self.process.removeListener('done', done);
				self.emit('done', err);
			}
		}
	};

	MultiplexedProcess.prototype.reap = function() {
		this.process.reap = true;
		delete this.process.invoking[this.invokeid];
		procCount--;
	};

	MultiplexedProcess.prototype.destroy = function() {
		this.process.multiplexCount--;
		if (this.process.multiplexCount <= 0) {
			if (!this.process.reap) {
				procCount--;
			}
			delete shallow[this.process.pid];
			this.process.destroy();
		} else {
			if (!this.process.reap) {
				shallow[this.process.pid] = this.process;
			}
		}
	};




	return Pool({
		name: 'LambdaMultiplexPool',
		create: create,
		destroy: function(mproc) {
			mproc.destroy();
			//sendQueueStats();
		},
		validate: function(mproc) {
			return mproc.process.connected && !mproc.process.reap && !mproc.invalid;
		},
		max: opts.maxWorkers * (opts.maxPerProcess)
	});
};
