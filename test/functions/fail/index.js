
exports.handler = function(args, context) {
	setTimeout(function() {
		console.error('oh noes', process.pid);
		context.done(new Error('This is an example function failure.'));
	}, 50);
};