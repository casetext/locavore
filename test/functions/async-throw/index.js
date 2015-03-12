
exports.handler = function(args, context) {
	setTimeout(function() {
		throw new Error('Async throw');
	}, 50);
};