#!/usr/bin/env node

var Web = require('./web'),
	Locavore = require('./locavore');
	argv = require('yargs')
		.alias('p','port').describe('p','Port to listen on')
		.alias('w','workers').describe('w','Maximum concurrent worker processes')
		.alias('m','monitor').describe('m','Open monitor server on port 3034').boolean('m')
		.alias('M','monitor-port').describe('M','Open monitor server on this port')
		.describe('perprocess','Maximum concurrent invocations per worker process.  Read and understand the caveats at https://github.com/casetext/locavore#tenancy before using this option.')
		.describe('prefix','Function name prefix regex')
		.boolean('d').describe('d','Debug mode')
		.alias('v','verbose').describe('v','Verbosity 0-4').default('v', 4)
		.usage('Usage: $0 [options] [directory]\r\n(directory defaults to cwd)')
		.help('help')
		.argv;

var locavore = new Locavore({
	debug: argv.d,
	folder: argv._[0] || process.cwd(),
	maxWorkers: argv.w,
	maxPerProcess: argv.perprocess,
	verbosity: argv.v,
	prefix: argv.prefix ? new RegExp(argv.prefix) : null
});

if (argv.M) {
	locavore.listenForMonitor(argv.M);
} else if (argv.m) {
	locavore.listenForMonitor(3034);
}

new Web(locavore).listen(argv.p || process.env.PORT || 3033);

locavore.functionList(function(err, list) {
	console.log('Ready. ', list.length, 'functions');
});