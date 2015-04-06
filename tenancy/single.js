var spawner = require('./spawner'),
	cpus = require('os').cpus().length,
	path = require('path'),
	Pool = require('generic-pool').Pool;

exports.getPool = function(opts) {
	return Pool({
		name: 'LambdaPool',
		create: function(cb) {
			spawner.getProcess(opts, cb);
		},
		destroy: function(proc) {
			proc.destroy();
			//sendQueueStats();
		},
		validate: function(proc) {
			return proc.connected && !proc.invalid;
		},
		max: opts.maxWorkers || cpus * 2
	});

};

