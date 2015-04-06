var child_process = require('child_process'),
	path = require('path');

exports.getProcess = function(opts, cb) {
	var proc = child_process.fork(path.join(__dirname, '..', 'worker.js'), [], {
		silent: true,
		execArgv: opts.debug ? ['--debug-brk'] : []
	});
	if (!opts.debug) {
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
				if (opts.verbosity >= 1) {
					console.error(now(proc.invokeid), 'Strange worker proc error'.red, err);
				}
			});
			ready();
		}
	});
	if (opts.verbosity >= 3) {
		proc.stdout.on('data', function(data) {
			process.stdout.write(now(proc.invokeid).bgBlue + ' ' + data);
		});
	}
	if (opts.verbosity >= 2) {
		proc.stderr.on('data', function(data) {
			process.stdout.write(now(proc.invokeid).bgRed + ' ' + data);
		});
	}

	function oops(err) {
		clearTimeout(timeout);
		cb(err);
	}

	function ready() {
		proc.on('exit', function(code) {
			proc.emit('done', new Error('Worker exited with code ' + code));
		});
		proc.on('error', function(err) {
			proc.emit('done', err);
		});
		proc.on('message', function(msg) {
			proc.emit('done', msg.err, msg);
		});

		proc.destroy = function() {
			proc.removeAllListeners();
			proc.kill();
			proc.send = null;
			proc.invalid = true;
		};
		cb(null, proc);
	}
};


/*

function Process(proc, opts) {
	var self = this;
	this.process = proc;
	this.pid = proc.pid;
	this.opts = opts;
	this.invoking = {};


}

Process.prototype.done = function(err, result) {
	//clearTimeout(timeout);
	if (this.opts.debug) {
		this.destroy();
		this._destroy();
	} else {
		this.invokeid = null;
		this._release();
	}
	done(err, result);
};

Process.prototype.destroy = function() {
	this.process.removeAllListeners();
	this.process.kill();
};

Process.prototype.invoke = function(args) {
	this.invokeid = args.id;
	this.invoking[args.id] = true;
	this.process.send(args);
};


exports.Process = Process;*/

function now(id) {
	return '['.gray + id + ' ' + new Date().toISOString().gray + ']'.gray;
}