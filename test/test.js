var Locavore = require('../locavore'),
	Redis = require('../redis'),
	redisConnection = require('redis').createClient(),
	path = require('path'),
	expect = require('chai').expect;

var testFunctions = path.join(__dirname, 'functions'), locavore;


describe('Locavore', function() {

	describe('basics', function() {
		configure(1, 1, /test_/);
		it('strips prefixes', function(done) {
			locavore.invoke('test_ok', {}, ifErr(done));
			locavore.drain(function() {
				compareStats(1, 0, done);
			});
		});
	});
	
	describe('single tenancy', function() {
		configure(4, 1);
		tests(8);
	});

	describe('multiple tenancy', function() {
		configure(4, 4);
		tests(32);
	});

	describe('extreme tenancy', function() {
		configure(8, 64);
		tests(1024);
	});

	describe('multiple tenancy (only)', function() {
		configure(1, 2);
		it('handles timeout correctly', function(done) {
			this.timeout(4000);
			locavore.invoke('timeout', {}, ifErr(done));
			locavore.invoke('long', {}, ifErr(done));
			setTimeout(function() {
				locavore.invoke('ok', {}, ifErr(done));
				locavore.drain(function() {
					compareStats(3, 1, done);
				});
			}, 1100);
		});

		it('handles crashes correctly', function(done) {
			locavore.invoke('long', {}, ifErr(done));
			locavore.invoke('async-throw', {}, ifErr(done));
			locavore.drain(function() {
				compareStats(2, 2, done);
			});
		});
	});

	describe('redis', function() {
		configure(4, 1);
		var redis;
		beforeEach(function(done) {
			redisConnection.del('test-queue', function() {
				redisConnection.del('test-queue.run', function() {
					redis = new Redis(locavore);
					redis.connect(null, null, 'test-queue');
					done();
				});
			});
		});

		afterEach(function(done) {
			redis.shutdown();
			
			redisConnection.llen('test-queue', function(err, count) {
				if (err) {
					throw err;
				}
				if (count > 0) {
					throw new Error('Did not leave an empty queue');
				}
				redisConnection.llen('test-queue.run', function(err, count) {
					if (err) {
						throw err;
					}
					if (count > 0) {
						throw new Error('Did not leave an empty run queue');
					}
					done();
				});
			});
		});

		it('handles jobs', function(done) {
			redisInvoke('ok');
			locavore.once('invoke', function() {
				locavore.drain(function() {
					compareStats(1, 0, done);
				});
			}, 100);
		});


		it('handles many jobs', function(done) {
			// var log = console.log, start = Date.now();
			// console.log = function() {
			// 	process.stdout.write('[+ ' + (Date.now() - start) + '] ');
			// 	log.apply(console, arguments);
			// };
			this.timeout(5000);
			redisInvoke('long');
			redisInvoke('long');
			redisInvoke('long');
			redisInvoke('long');
			redisInvoke('long');
			redisInvoke('long');
			
			bounce('invoke', 6, function() {
				
				locavore.drain(function() {
					compareStats(6, 0, done);
				});
			});
		});


		it('handles anarchy', function(done) {
			
			this.timeout(5000);
			
			for (var i = 0; i < 16; i++) {
				redisInvoke(['ok','fail','ok','sync-throw','ok','timeout'][i%6], {i:i});
			}
			
			bounce('invoke', 16, function() {
				
				locavore.drain(function() {
					compareStats(16, 8, done);
				});
			});

		});

	});
});

function configure(workers, perProcess, prefix) {
	beforeEach(function() {
		locavore = new Locavore({
			verbosity: 0,
			folder: testFunctions,
			maxWorkers: workers,
			maxPerProcess: perProcess,
			prefix: prefix
		});
	});
	
	afterEach(function() {
		locavore.shutdown();
	});
	
}


function tests(count) {


	it('runs a job', function(done) {
		testInvoke('ok', false, done);
	});

	it('deals with non-existent functions', function(done) {
		locavore.invoke('foobar', {}, function(err) {
			expect(err).to.exist;
			done();
		});
	});

	it('handles done(err)', function(done) {
		testInvoke('fail', true, done);
	});

	it('handles functions that throw synchronously', function(done) {
		testInvoke('sync-throw', true, done);
	});

	it('handles functions that throw asynchronously', function(done) {
		testInvoke('async-throw', true, done);
	});

	it("handles files that don't load properly", function(done) {
		testInvoke('no-boot', true, done);
	});

	it('kills jobs that time out', function(done) {
		locavore.invoke('timeout', {}, function(err) {
			if (err) return done(err);
			locavore.drain(function() {
				compareStats(1, 1, done);
			});
		});
	});

	it('runs all the jobs', function(done) {

		var dones = 0;

		for (var i = 0; i < count; i++) {
			locavore.invoke('ok', {i:i}, function(err) {
				if (err) return done(err);
				if (++dones == count) {
					locavore.drain(function() {
						compareStats(count, 0, done);
					});
				}
			});
		}
		
	});


	it('handles anarchy', function(done) {
		this.timeout(5000);
		
		for (var i = 0; i < count; i++) {
			locavore.invoke(['ok','fail','ok','sync-throw','ok','timeout'][i%6], {i:i}, ifErr(done));
		}

		setTimeout(function() {
			locavore.invoke('ok', {}, function(err) {
				if (err) done(err);

				locavore.drain(function() {
					compareStats(count+1, count/2, done);
				});
			});
		}, 1200);
	});

	it('handles a stream of invocations', function(done) {
		this.timeout(5000);
		var invokes = 0, ivl = setInterval(function() {
			locavore.invoke('ok', {}, function(err) {
				if (err) {
					clearInterval(ivl);
					return done(err);
				}

				if (++invokes >= Math.min(count, 64)) {
					clearInterval(ivl);
					locavore.drain(function() {
						compareStats(Math.min(count, 64), 0, done);
					});
				}
			});
		}, 25);
	});
}

function bounce(ev, count, cb) {
	var seen = 0;
	locavore.on(ev, ping);

	function ping() {
		if (++seen == count) {
			locavore.removeListener(ev, ping);
			cb();
		}
	}
}

function testInvoke(fn, expectError, cb) {
	locavore.invoke(fn, {}, function(err) {
		if (err) return cb(err);
		locavore.drain(function() {
			compareStats(1, expectError ? 1 : 0, cb);
		});
	});
}

function redisInvoke(fn, args, cb) {
	redisConnection.lpush('test-queue', JSON.stringify({
		date: Date.now(),
		fn: fn,
		args: args
	}), cb);
}

function compareStats(expectedDone, expectedErrors, cb) {
	locavore.stats(function(err, stats) {
		if (err) return cb(err);
		expect(stats.done).to.equal(expectedDone);
		expect(stats.errors).to.equal(expectedErrors);
		cb();
	});
}

function ifErr(cb) {
	return function(err) {
		if (err) {
			cb(err);
		}
	};
}