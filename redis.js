var Redis = require('redis');


function RedisQueueHandler(locavore) {
	this.locavore = locavore;
}

RedisQueueHandler.prototype.connect = function(port, host, queue) {
	var self = this;
	this.port = port = port || 6379;
	this.host = host = (host && host !== true ? host : null) || '127.0.0.1';
	this.queue = queue = queue || 'default-queue';

	var redisQueueListener = Redis.createClient(port, host, {}),
		redisQueueSweeper = Redis.createClient(port, host, {});

	this._redis = [redisQueueListener, redisQueueSweeper];


	function dequeue() {
		if (self._destroy) {
			return;
		}
		redisQueueListener.brpoplpush(queue, queue + '.run', 0, function(err, item) {
			
			if (item) {
				try {
					var cfg = JSON.parse(item);
					self.locavore.invoke(cfg.fn, cfg.args, function(err) {
						if (err) {
							done(err);
						}

						self.locavore.free(dequeue);
						
					}, done);
				} catch(ex) {
					done(ex);
				}
			}

			function done(err, result) {
				redisQueueSweeper.lrem(queue + '.run', 0, item, function(err) {
					if (err) {
						console.error('Error removing from ' + queue + '.run', err);
					}
				});

			}
		});
	}
	dequeue();

};

RedisQueueHandler.prototype.shutdown = function() {
	this._destroy = true;
	this._redis.forEach(function(redis) {
		redis.end();
	});

};

exports = module.exports = RedisQueueHandler;
