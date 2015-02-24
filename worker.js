var memwatch = require('memwatch')
	, prettyHrtime = require('pretty-hrtime');


process.on('message', function(msg) {
	run(msg);
});


function run(task) {
	var context = {
		invokeid: task.id,
		done: function(err, result) {
			var time = process.hrtime(t), mem = hd.end().change;

			if (err instanceof Error) {
				// `Error` makes its properties non-enumerable, so an empty object would be all that gets serialized.
				// This makes it so the error message actually makes it back to the main process.
				err = {
					_exception: {
						type: err.type,
						message: err.message,
						stack: err.stack
					}
				};
			}

			// The setTimeout helps avoid a situation where the master prints "job done" to the
			// console BEFORE the last of stdout from this process is echoed, resulting in you
			// seeing a very confusing series of events in the console.
			setTimeout(function() {
				process.send({
					err: err,
					returnValue: result,
					time: prettyHrtime(time),
					ms: (time[0] * 1000) + (time[1] / 1000 / 1000),
					mem: mem.size,
					memBytes: mem.size_bytes
				});
			}, 1);
		}
	};

	var hd = new memwatch.HeapDiff(), t = process.hrtime();
	try {
		require(task.path)[task.fn](task.data, context);
	} catch(ex) {
		context.done(ex.toString() + '\r\n' + ex.stack);
	}

}


process.send({ ready: true });