
exports.handler = function(args, context) {
	setTimeout(function() {
		context.done();
	}, 1500);
};