locavore
========

[![Build Status](https://travis-ci.org/casetext/locavore.svg)](https://travis-ci.org/casetext/locavore)

Locavore runs lambda functions locally.  It emulates AWS Lambda on your machine.

Locavore keeps a pool of worker processes that jobs are distributed to.  By default, it will only allow *cpu cores* * 2 concurrent jobs; additional jobs will be queued in-memory.

Locavore watches the filesystem for changes to your functions.  When a change is detected, it will gracefully reload your functions.  Currently executing invocations are allowed to finish; new invocations are sent to freshly spawned worker processes.

If you're particularly masochistic, you can even use locavore to run your functions in production.  A redis-backed queue is provided.

Usage
-----

Locavore expects a folder full of folders.  Each subfolder represents one lambda function.  It should contain at least package.json file and one js file.  (either index.js or the file named in [`main`](https://docs.npmjs.com/files/package.json#main))

### Running: Option 1
`npm install -g locavore`.  Type `locavore` in a folder that contains one or more folders containing your lambda functions.  (Or type `locavore <path-to-functions-folder>`)

Locavore will start a web server that emulates the Lambda REST API.  The server runs on port:

- Specified by `-p` or `--port`; or
- Specified by the `PORT` environment variable; or
- 3033

You can also have locavore listen to a redis queue with `-r`.  The default is `127.0.0.1:6379/default-queue`.  [hatstall](https://github.com/casetext/hatstall) is [an example of how to enqueue invocation requests](https://github.com/casetext/hatstall/blob/master/invoker/redis.js).

<!-- ... -->

    Usage: locavore [options] [directory]
    (directory defaults to cwd)
    
    Options:
      -p, --port          Port to listen on
    
      -r, --redis         Listen to redis queue at host:port/queuename
    
      -w, --workers       Maximum concurrent worker processes
    
      -m, --monitor       Open monitor server on port 3034
    
      -M, --monitor-port  Open monitor server on this port
    
      -u, --mem           Track function memory usage
    
      --perprocess        Maximum concurrent invocations per worker process.  Read
                          and understand the caveats at
                          https://github.com/casetext/locavore#tenancy before using
                          this option.
    
      --prefix            Function name prefix regex
    
      -d                  Debug mode
    
    -v, --verbose       Verbosity 0-4                                 [default: 4]
    
      --help              Show help

### Running: Option 2
`require('locavore')` in your project.  

You can then instantiate a `new Locavore({...})` and then use a `new Web({...})` to stand up the Lambda REST API server, a `new Redis({...})` to listen to a redis queue, and/or you can use the [programmatic API](#api) to invoke functions.

Tenancy
-------

Locavore can run in two modes: single-tenant and multi-tenant.

In the default single-tenant mode, every function invocation runs in its own worker process.  The worker process is reused only after the function completes.

This is the safest mode of operation because every function invocation is isolated from others.  If the function causes a crash (ie by throwing an unhandled exception) or performs CPU-heavy work, other invocations are not affected.  The trade-off is that you are rather limited in the number of concurrent invocations: processes are expensive, so you can only run a relatively small number at once.  Thus, if you have a large number of function invocations, they will quickly form a long queue.

The alternative is multi-tenant mode.  Here, each worker process may concurrently run multiple function invocations.  This gives us obvious speed and resource usage benefits (especially for tasks that are very I/O bound), but means that one function's crash or CPU usage will affect its neighbors.

Tenancy is controlled by the `maxPerProcess` option.

API
---

### `new Locavore(options)`

Initializes Locavore.

- `options.folder` (required) - the path to a folder containing folders of lambda functions.
- `options.watch` - whether locavore should watch for changes to function code and automatically reload changed code.  Defaults to `true`.
- `options.maxWorkers` - the maximum number of concurrent functions.  Defaults to *cpu cores* * 2.
- `options.maxPerProcess` - controls function-process [tenancy](#tenancy).  Defaults to 1; make sure you [read and understand the caveats](#tenancy) before increasing this number.
- `options.prefix` - a `RegExp` that matches a function name prefix.  `invoke()` strips the prefix from the supplied function name before comparing to known function names.  Useful if you use prefix-based versioning.
- `options.debug` - enable debug mode.  In debug mode, locavore sets `maxWorkers` and `maxPerProcess` to 1, disables timeouts, and spawns a new worker process for each function invocation with `--debug-brk`.  You must then connect a debugger to the process and resume execution.
- `options.mem` - track function memory usage.  This requires worker processes to do a full garbage collection prior to every invocation, which can add significant runtime overhead.
- `options.verbosity` - controls how much output goes to the console.  Defaults to 4.
  <ol start="0">
  <li type="1">nothing</li>
  <li type="1">critical: bad function package.json, missing funciton</li>
  <li type="1">errors: function errors, worker stderr</li>
  <li type="1">logs: worker stdout</li>
  <li type="1">verbose: function start/stop</li>
  </ol>

#### `Locavore#init()`

Reloads all of the functions in this instance's `options.folder`.  Any currently executing tasks are allowed to finish.  New requests are routed to new worker processes with the updated code.

#### `Locavore#invoke(fn, data, cb)`

Invokes the function (in the folder) named `fn` and passes in `data`.

#### `Locavore#functionList(cb)`

Gives you a list of functions that locavore knows about.

#### `Locavore#listenForMonitor(port)`

Listens for connections from the CLI monitor.  `port` defaults to 3034.

#### `Locavore#closeMonitor([cb])`

Closes the CLI monitor port and disconnects any clients.

#### `Locavore#stats(cb)`

Gives you an object containing the following statistics:

- `workers` - The current number of worker processes
- `avail` - The current number of available workers
- `queued` - The current number of queued function invocations
- `done` - The total number of completed function invocations

#### `Locavore#resetStats()`

Resets the invocation/error counts.

#### `Locavore#drain([cb])`

Calls the function `cb` after all pending function invocations have completed.

**Warning:**  No additional functions can be invoked after `drain()`.  Call `init` again to reset.

#### `Locavore#shutdown()`

Shuts down locavore immediately, killing worker processes.  It's usually a good idea to `drain()` first.

### `new Web(locavore)`

Creates a new Lambda REST API server attached to the supplied `Locavore` instance.

#### `Web#listen(...)`

Begin accepting connections to the REST server.  The arguments are identical to [`http.Server#listen`](https://nodejs.org/api/http.html#http_server_listen_port_hostname_backlog_callback).

### `new Redis(locavore)`

Creates a new redis queue adapter attached to the supplied `Locavore` instance.

#### `Redis#connect([port[, host[, queue]]])`

Connects the adapter to the specified redis server.  `port` defaults to `6379`, `host` to `127.0.0.1`, and `queue` to `'default-queue'`.  Multiple locavores may safely listen to the same queue.

REST API
--------

Locavore supports a subset of [Lambda's API endpoints](http://docs.aws.amazon.com/lambda/latest/dg/API_Operations.html):

- `/2014-11-13/functions/<function-name>/invoke-async/`
- `/2014-11-13/functions/`

Redis Queue
-----------

Locavore `RPOP`s items off of a redis list.  The items are expected to be JSON-serialized strings of:

    {
        "date": Date.now(),
        "fn": "function-name",
        "args": { ... }
    }

`LPUSH` onto the list.

Monitoring
----------

Locavore comes with a command-line tool to monitor the overall status of the server.

![screenshot](http://i.imgur.com/4tEL0jM.png)

This shows you average function execution time, memory usage guesstimate, and run/error count.

When you `npm install -g locavore`, npm adds the `lvtop` command.

	Usage: lvtop
	
	Options:
	  -p, --port  Connect to this port                               [default: 3034]
	  
	  -h, --host  Connect to this host                        [default: "127.0.0.1"]
	  
	  --help      Show help

Changes since 1.x
=================

Locavore 1.x exposed itself as a singleton.  It is now a class that can be instantiated multiple times.  Instead of:

    var locavore = require('locavore');
    locavore.core.init({...});

Now:

    var locavore = new require('locavore').Locavore({...});

The REST API server is similar.

The redis queue functionality is new in 2.0.