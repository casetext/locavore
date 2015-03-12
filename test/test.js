var locavore = require('../locavore'),
	path = require('path'),
	expect = require('chai').expect;

var testFunctions = path.join(__dirname, 'functions');

describe('Locavore', function() {
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
});

function configure(workers, perProcess) {
	beforeEach(function() {
		locavore.init({
			quiet: true,
			folder: testFunctions,
			maxWorkers: workers,
			maxPerProcess: perProcess
		});

		locavore.resetStats();
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
				setTimeout(function() {
					compareStats(1, 1, done);
				}, 600);
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
				if (err) return done(err);

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


function testInvoke(fn, expectError, cb) {
	locavore.invoke(fn, {}, function(err) {
		if (err) return cb(err);
		locavore.drain(function() {
			compareStats(1, expectError ? 1 : 0, cb);
		});
	});
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