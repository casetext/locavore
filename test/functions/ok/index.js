
exports.handler = function(args, context) {
	setTimeout(function() {
		console.log('ok', process.pid);
		context.done();
	}, 50);
};