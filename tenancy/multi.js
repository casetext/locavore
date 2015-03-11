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
		proc.multiplexCount = (proc.multiplexCount || 0) + 1;
		proc.invoking = {};
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
			delete self.process.invoking[args.id];
			if (result && result.id) {
				if (result.id == args.id) {
					self.process.removeListener('done', done);
					self.emit('done', err, result);
				}
			} else {
				self.process.removeListener('done', done);
				self.emit('done', err);
			}
		}
	};

	MultiplexedProcess.prototype.destroy = function(reap) {
		if (reap) {
			this.process.reap = reap;
			delete this.process.invoking[this.invokeid];
			procCount--;
		}
		if (--this.process.multiplexCount <= 0) {
			if (!this.process.reap) {
				procCount--;
			}
			delete shallow[this.process.pid];
			this.process.destroy();
		} else {
			shallow[this.process.pid] = this.process;
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
			return mproc.process.connected && !mproc.process.reap;
		},
		max: opts.maxWorkers * (opts.maxPerProcess)
	});
};
