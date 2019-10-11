const assert = require('assert-plus');
const uuid = require('uuid/v4');
const ioredis = require('ioredis');

function Events(options){
    this.listeners = {};
    this.queueListeners = {};
    this.queues = [];
    this.log = function(a){console.log(a);};

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

        this.subClient.on('message', (channel, message) => {
            var listeners = this.listeners[channel];

            if (!listeners || listeners.length == 0) {
                return;
            }

            for (let listener of listeners) {
                listener.method.call(listener.context, channel, JSON.parse(message));
            }
        });

    } else {
        //custom
        this.redis = false;
    }

}

Events.prototype.monitorQueue = function(queueName, redis) {
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
};

Events.prototype.close = async function() {
    this.isClosing = true;
    for (let queue of this.queues) {
        clearInterval(queue.interval);
        await queue.redis.disconnect();
    }

    await this.pubClient.disconnect();
    await this.subClient.disconnect();
    await this.queueClient.disconnect();
};

Events.prototype.on = async function(event, listener, context){
    if (this.redis) {
        await this.subClient.subscribe(event);
    }

    if (this.listeners[event]){
        this.listeners[event].push({method:listener, context:context});
    } else {
        this.listeners[event] = [{method:listener, context:context}];
    }
};

Events.prototype.onDequeue = async function(queueName, listener, context){
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
};

Events.prototype.emit = async function(event, args){
    if (this.redis) {
        args.channel = event;
        args.eventId = uuid();
        args.emittedAt = Date.now();
        await this.pubClient.publish(event, JSON.stringify(args));
    } else {
        let listeners = this.listeners[event];

        if (!listeners || listeners.length == 0) {
            this.log(`Warning: No listeners on ${event}, message lost: ${JSON.stringify(args)}`);
            return;
        }

        for (let listener of listeners) {
            listener.method.call(listener.context, event, args);
        }
    }
};

Events.prototype.enqueue = async function(queueName, args){
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
};



module.exports = Events;