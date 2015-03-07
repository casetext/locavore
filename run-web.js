var web = require('./web'),
	argv = require('yargs').argv,
	locavore = require('./locavore');



locavore.init({
	debug: argv.d,
	folder: argv._[0] || process.cwd()
});

web.listen(3033);

locavore.functionList(function(err, list) {
	console.log('Ready. ', list.length, 'functions');
});