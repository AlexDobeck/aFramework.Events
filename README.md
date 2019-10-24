# aFramework.Events

This library provides two EventEmitters: RedisQueue and RedisEvents, providing easy Queues and Pub/Sub functionality for use in a multi-instance or a sever farm environment.

RedisQueue provides Queuing functionality. Exactly one subscriber will recieve the event, if the listener fails to complete succesfully (throws an error or otherwise doesn't complete), the event will be requeued and free to grab by another (or the same) client.

RedisEvents provides Pub/Sub functionality. Every subscriber will recieve every event which occurs while they are listening. 

## Important Methods
### async on(eventName, listener)
When an event matching the eventName is emitted, the listener will be called with the arguments.
To begin listening to redis a network/io call needs to be made. If this method is not awaited, any events emitted on this client before that resolves will be lost. This is only a concern if you hope to immediately emit an event that the current client cares about.

### async emit(eventName[, ...args])
Emits the event and optional arguments, identical in usage to EventEmitter. Awaiting is optional unless you require a gaurntee that the event has been stored in redis before continuing.

### async close()
Cleans up active redis connections and listeners.

## Basic Usage
```javascript
let rQueue = new aEvents.RedisQueue({redis:{host:'127.0.0.1', port:'6379}}

await rQueue.on('queue', (args) => {
  console.log(`#1 recieved queue job: ${JSON.stringify(args)}`);
}
await rEvents.on('queue', (args) =>{
  console.log(`#2 recieved queue job: ${JSON.stringify(args)}`);
}

rQueue.emit('queue', {arg1:'test'});
// #1 recieved queue job: {"arg1":"test"}
```
```javascript
let rEvents = new aEvents.RedisEvents({redis:{host:'127.0.0.1', port:'6379}}
await rEvents.on('broadcast', (args) =>{
  console.log(`#1 recieved broadcast: ${JSON.stringify(args)}`);
}
await rEvents.on('broadcast', (args) =>{
  console.log(`#2 recieved broadcast: ${JSON.stringify(args)}`);
}

rEvents.emit('broadcast', {arg2:'test'});
//#1 recieved broadcast: {"arg2":"test"}
//#2 recieved broadcast: {"arg2":"test"}

```

## Options
### Queue
Option | Description
------------ | -------------
redis | object detailing redis configuration
redis.queueKeyPredicate | a string which will be prepended to all queue keys in redis.
redis.requeueDelay | the delay in miliseconds before an event will be re-queued. Defaults to 60 seconds.
redis.host | the host of the redis instance (required if queueClient is not supplied)
redis.port | the port of the redis instance (required if queueClient is not supplied)
redis.queueClient | a writable redis client instance. ioRedis is used internally, but can be most clients.
redis.blockingQueueClientFunction | a function which returns a redis client instance when called. Each instance will be blocked while waiting for an event, so it's best for this function to return a newly created client which will be disposed of on close
log | a function which will be called with a string parameter containing Error info.

### Events
Option | Description
------------ | -------------
redis | object detailing redis configuration
redis.host | the host of the redis instance (required if subHost or sub/pubClients are not supplied)
redis.port | the port of the redis instance (required if pubHost or sub/pubClients are not supplied)
redis.subClient | a readable redis client instance. ioRedis is used internally, but can be most clients.
redis.pubClient | a writable redis client instance. ioRedis is used internally, but can be most clients.
redis.subHost  | the host of a readable redis instance (used to specify different hosts/ports between sub/pub clients)
redis.subPort | the port of a readable redis instance (used to specify different hosts/ports between sub/pub clients)
redis.pubHost  | the host of a readable redis instance (used to specify different hosts/ports between sub/pub clients)
redis.pubPort | the port of a readable redis instance (used to specify different hosts/ports between sub/pub clients)
log | a function which will be called with a string parameter containing Error info.


## TODO:
* Allow Queue listeners to provide failure status beyond throwing
* Override removeListener
* Publish on NPM
