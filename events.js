const EventEmitter = require('events');

const assert = require('assert-plus');
const uuid = require('uuid/v4');
const ioredis = require('ioredis');

const util = require('util');

class Events extends EventEmitter {
    constructor(options){
        super();

        //this.listeners = {};
        this.queueListeners = {};
        this.queues = [];
        this.log = options && options.log ? options.log : function(a){console.log(a);};

        if (options && options.redis) {
            this.queueKeyPredicate = options.redis.queueKeyPredicate || '';
            if (this.queueKeyPredicate.slice(-1) != ':'){
                this.queueKeyPredicate += ':';
            }
            this.requeueDelay = options.redis.requeueDelay || 60000;
            this.redis = true;
            if (options.redis.host && options.redis.port){
                this.pubClient = new ioredis(options.redis.port, options.redis.host || "127.0.0.1");
                this.subClient = new ioredis(options.redis.port, options.redis.host || "127.0.0.1");
                this.blockingQueueClientFunction = function(){return new ioredis(options.redis.port, options.redis.host || "127.0.0.1")};
                this.queueClient = new ioredis(options.redis.port, options.redis.host || "127.0.0.1");
            } else {
                if (options.redis.pubClient) {
                    this.pubClient = options.redis.pubClient;
                } else {
                    this.pubClient = new ioredis(options.pubPort || "6379", options.pubHost || "127.0.0.1");
                }
                if (options.redis.subClient) {
                    this.subClient = options.redis.subClient;
                } else {
                    this.subClient = new ioredis(options.subPort || "6379", options.subHost || "127.0.0.1");
                }
                if (options.redis.blockingQueueClientFunction) {
                    this.blockingQueueClientFunction = options.redis.blockingQueueClientFunction;
                } else {
                    this.blockingQueueClientFunction = function() {return new ioredis(options.blockingQueuePort || "6379", options.blockingQueueHost || "127.0.0.1")};
                }
                if (options.redis.queueClient) {
                    this.queueClient = options.redis.queueClient;
                } else {
                    this.queueClient = new ioredis(options.queuePort || "6379", options.queueHost || "127.0.0.1");
                }
            }

            this.subClient.on('message', async (channel, message) => {
                await super.emit(channel, JSON.parse(message));
                // var listeners = this.listeners[channel];
                //
                // if (!listeners || listeners.length == 0) {
                //     return;
                // }
                //
                // for (let listener of listeners) {
                //     listener.method.call(listener.context, channel, JSON.parse(message));
                // }
            });

        } else {
            //custom
            this.redis = false;
        }

    };

    monitorQueue(queueName, redis){
        let queueLoop = async function () {
            let eventId;
            try {
                eventId = await redis.brpoplpush(`${this.queueKeyPredicate + queueName}`, `${this.queueKeyPredicate}:${this.queueName}:processing`, 0);
            } catch(err){}

            if (this.isClosing){
                return;
            }

            if (!eventId) {
                queueLoop();
                return;
            }

            let event = JSON.parse(await this.queueClient.get(`${this.queueKeyPredicate + queueName}:${eventId}`));

            let listeners = this.queueListeners[event.channel];

            if (!listeners || listeners.length == 0) {
                this.log(`ERROR: No listeners on channel: ${event.channel} for eventId: ${event.eventId}. Added to failed set.`);
                await this.queueClient.lrem(`${this.queueKeyPredicate + queueName}:processing`, 1, event.eventId);
                await this.queueClient.rpush(`${this.queueKeyPredicate + queueName}:failed`, event.eventId);
                queueLoop();
                return;
            }

            for (let listener of listeners) {
                await listener.method.call(listener.context, event, event.channel);
            }

            await this.queueClient.lrem(`${this.queueKeyPredicate + queueName}:processing`, 1, event.eventId);
            await this.queueClient.del(`${this.queueKeyPredicate + queueName}:${eventId}`);

            queueLoop(redis);
        }.bind(this);
        queueLoop();

        let requeueLoop = async function () {
            let processing = await this.queueClient.lrange(`${this.queueKeyPredicate + queueName}:processing`, 0, -1);

            for (let eventId of processing) {
                let lock = await this.queueClient.get(`${this.queueKeyPredicate + queueName}:lock:processing:${eventId}`);

                if (lock === null) {
                    await this.queueClient.setex(`${this.queueKeyPredicate + queueName}:lock:processing:${eventId}`, 60, null);
                    await this.queueClient.lrem(`${this.queueKeyPredicate + queueName}:processing`, 1, eventId);
                    await this.queueClient.rpush(`${this.queueKeyPredicate + queueName}`, eventId);
                }
            }
        }.bind(this);
        let interval = setInterval(requeueLoop, this.requeueDelay);

        this.queues.push({redis: redis, interval: interval});
    }

    async close(){
        this.isClosing = true;
        for (let queue of this.queues) {
            clearInterval(queue.interval);
            await queue.redis.disconnect();
        }

        await this.pubClient.disconnect();
        await this.subClient.disconnect();
        await this.queueClient.disconnect();
    }

    async on(eventName, listener){
        await this.subClient.subscribe(eventName);

        return super.on(eventName, listener);
    }
    async once(eventName, listener){
        if (typeof listener !== 'function') {
            throw new Error('Invalid listener function:' + listener);
        }

        return await this.on(eventName, _onceWrap(this, eventName, listener));
    }

    async subscribe(eventNames){
        for(let event of eventNames){
            await this.subClient.subscribe(event);
        }
    }

    async onDequeue(queueName, listener, context){
        if (this.redis) {
            if (!this.queues[queueName]) {
                this.queues[queueName] = this.monitorQueue(queueName, this.blockingQueueClientFunction());
            }
        }

        if (this.queueListeners[queueName]){
            this.queueListeners[queueName].push({method:listener, context:context});
        } else {
            this.queueListeners[queueName] = [{method:listener, context:context}];
        }
    }

    async emit(event, args){
        args.channel = event;
        args.eventId = uuid();
        args.emittedAt = Date.now();
        await this.pubClient.publish(event, JSON.stringify(args));
    }

    async enqueue(queueName, args){
        if (this.redis) {
            args.channel = queueName;
            args.eventId = uuid();
            args.emittedAt = Date.now();
            await this.queueClient.setex(`${this.queueKeyPredicate + queueName}:lock:processing:${args.eventId}`, 60, null);
            await this.queueClient.set(`${this.queueKeyPredicate + queueName}:${args.eventId}`, JSON.stringify(args));
            await this.queueClient.rpush(this.queueKeyPredicate + queueName, args.eventId);
        } else {
            let listeners = this.queueListeners[event];

            if (!listeners || listeners.length == 0) {
                this.log(`Warning: No listeners on ${event}, message lost: ${JSON.stringify(args)}`);
                return;
            }

            for (let listener of listeners) {
                listener.method.call(listener.context, event, args);
            }
        }
    }
}

function onceWrapper() {
    if (!this.fired) {
        this.target.removeListener(this.type, this.wrapFn);
        this.fired = true;
        if (arguments.length === 0)
            return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
    }
}

function _onceWrap(target, type, listener) {
    const state = { fired: false, wrapFn: undefined, target, type, listener };
    const wrapped = onceWrapper.bind(state);
    wrapped.listener = listener;
    state.wrapFn = wrapped;
    return wrapped;
}


module.exports = Events;