#!/usr/bin/env node

var web = require('./web'),
	argv = require('yargs')
		.alias('p','port')
		.argv,
	locavore = require('./locavore');



locavore.init({
	debug: argv.d,
	folder: argv._[0] || process.cwd()
});

web.listen(argv.p || process.env.PORT || 3033);

locavore.functionList(function(err, list) {
	console.log('Ready. ', list.length, 'functions');
});