locavore
========

Locavore runs lambda functions locally.  It emulates AWS Lambda on your machine.

Locavore keeps a pool of worker processes that jobs are distributed to.  By default, it will only allow *cpu cores* * 2 concurrent jobs; additional jobs will be queued.

Locavore watches the filesystem for changes to your functions.  When a change is detected, it will gracefully reload your functions.  Currently executing invocations are allowed to finish; new invocations are sent to freshly spawned worker processes.

Usage
-----

### Option 1
`npm install -g locavore`.  Type `locavore` in a folder that contains one or more folders containing your lambda functions.  (Or type `locavore <path-to-functions-folder>`)

Locavore will start a web server that emulates the Lambda REST API.  The server runs on port:

- Specified by `-p` or `--port`; or
- Specified by the `PORT` environment variable; or
- 3033

### Option 2
`require('locavore')` in your project.  

You can then call `locavore.core.init({...})` and then `locavore.web.listen(port)` to stand up the Lambda REST API server, or you can use the programmatic API.

API
---

### `locavore.core.init(options)`

Initializes Locavore.

- `options.folder` (required) - the path to a folder containing folders of lambda functions.
- `options.maxWorkers` - the maximum number of concurrent functions.  Defaults to *cpu cores* * 2.
- `options.debug` - enable debug mode.  In debug mode, locavore sets `maxWorkers` to 1, disables timeouts, and spawns a new worker process for each function invocation with `--debug-brk`.  You must then connect a debugger to the process and resume execution.

### `locavore.core.invoke(fn, data, cb)`

Invokes the function (in the folder) named `fn` and passes in `data`.

### `locavore.core.functionList(cb)`

Gives you a list of functions that Locavore knows about.

### `locavore.core.stats(cb)`

Gives you an object containing the following statistics:

- `workers` - The current number of worker processes
- `avail` - The current number of available workers
- `queued` - The current number of queued function invocations
- `done` - The total number of completed function invocations

### `locavore.core.drain(cb)`

Calls the function `cb` after all pending function invocations have completed.

REST API
--------

Locavore supports a subset of [Lambda's API endpoints](http://docs.aws.amazon.com/lambda/latest/dg/API_Operations.html):

- `/2014-11-13/functions/<function-name>/invoke-async/`
- `/2014-11-13/functions/`

Monitoring
----------

Locavore comes with a command-line tool to monitor the overall status of the server.

![screenshot](http://i.imgur.com/4tEL0jM.png)

This shows you average function execution time, memory usage guesstimate, and run/error count.

When you `npm install -g locavore`, npm adds the `lvtop` command.