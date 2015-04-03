#!/usr/bin/env node

var web = require('./web'),
	argv = require('yargs')
		.alias('p','port').describe('p','Port to listen on')
		.alias('w','workers').describe('w','Maximum concurrent worker processes')
		.describe('perprocess','Maximum concurrent invocations per worker process.  Read and understand the caveats at https://github.com/casetext/locavore#tenancy before using this option.')
		.describe('prefix','Function name prefix regex')
		.boolean('d').describe('d','Debug mode')
		.alias('v','verbose').describe('v','Verbosity 0-4').default('v', 4)
		.usage('Usage: $0 [options] [directory]\r\n(directory defaults to cwd)')
		.help('help')
		.argv,
	locavore = require('./locavore');

locavore.init({
	debug: argv.d,
	folder: argv._[0] || process.cwd(),
	maxWorkers: argv.w,
	maxPerProcess: argv.perprocess,
	verbosity: argv.v,
	prefix: argv.prefix ? new RegExp(argv.prefix) : null
});

web.listen(argv.p || process.env.PORT || 3033);

locavore.functionList(function(err, list) {
	console.log('Ready. ', list.length, 'functions');
});