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
			process.send({
				err: err,
				returnValue: result,
				time: prettyHrtime(time),
				ms: (time[0] * 1000) + (time[1] / 1000 / 1000),
				mem: mem.size,
				memBytes: mem.size_bytes
			});
		}
	};

	var hd = new memwatch.HeapDiff(), t = process.hrtime();
	require(task.path)[task.fn](task.data, context);

}


process.send({ ready: true });