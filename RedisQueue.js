const EventEmitter = require('events');

const assert = require('assert-plus');
const uuid = require('uuid/v4');
const ioredis = require('ioredis');

class RedisQueue extends EventEmitter {
    constructor(options) {
        super();

        assert.object(options, 'options');
        assert.object(options.redis, 'options.redis');

        this.queues = {};

        this.log = options && options.log ? options.log : function (a) {
            console.log(a);
        };

        if (options && options.redis) {
            this.queueKeyPredicate = options.redis.queueKeyPredicate || '';
            if (this.queueKeyPredicate != '' && this.queueKeyPredicate.slice(-1) != ':') {
                this.queueKeyPredicate += ':';
            }
            this.requeueDelay = options.redis.requeueDelay || 60000;

            if (options.redis.host && options.redis.port) {
                this.blockingQueueClientFunction = function () {
                    return new ioredis(options.redis.port, options.redis.host || "127.0.0.1")
                };
                this.queueClient = new ioredis(options.redis.port, options.redis.host || "127.0.0.1");
            } else {
                if (options.redis.blockingQueueClientFunction) {
                    this.blockingQueueClientFunction = options.redis.blockingQueueClientFunction;
                } else {
                    this.blockingQueueClientFunction = function () {
                        return new ioredis(options.blockingQueuePort || "6379", options.blockingQueueHost || "127.0.0.1")
                    };
                }
                if (options.redis.queueClient) {
                    this.queueClient = options.redis.queueClient;
                } else {
                    this.queueClient = new ioredis(options.queuePort || "6379", options.queueHost || "127.0.0.1");
                }
            }

        }
    }

    async emit(queueName, args){
        if (!args){
            args = {};
        }
        args.eventId = uuid();
        args.emittedAt = Date.now();
        await this.queueClient.setex(`${this.queueKeyPredicate + queueName}:lock:processing:${args.eventId}`, 60, null);
        await this.queueClient.set(`${this.queueKeyPredicate + queueName}:${args.eventId}`, JSON.stringify(args));
        await this.queueClient.rpush(this.queueKeyPredicate + queueName, args.eventId);
    }

    on(queueName, listener){
        if (!this.queues[queueName]) {
            this.queues[queueName] = monitorQueue(this.queueKeyPredicate + queueName, this.queueClient, this.blockingQueueClientFunction(), super.emit.bind(this), this.log);
        } else {
            this.queues[queueName].count++;
        }

        super.on(queueName, listener);
    }

    async removeListener(eventName, listener){
        let preLength = super.listeners(eventName).length;
        super.removeListener(eventName, listener);

        if (preLength > 0 && super.listeners(eventName).length === 0){
            let queue = this.queues[key];
            clearInterval(queue.interval);
            await queue.redis.disconnect();
            queue.redis.isClosing = true;
        }

        return this;
    }

    async once(queueName, listener){
        let wrap = ()=>{
            if (this.queues[queueName]) {
                this.queues[queueName].count--;
                if (this.queues[queueName].count === 0) {
                    clearInterval(this.queues[queueName].interval);
                    this.queues[queueName].redis.disconnect();
                    this.queues[queueName].redis.isClosing = true;
                    delete this.queues[queueName];
                }
            }
            if (arguments.length === 0) {
                return listener.call(this.target);
            } else {
                return listener.apply(this.target, arguments);
            }
        };

        super.once(queueName, wrap);
    }

    async close(){
        this.isClosing = true;
        for (let key of Object.keys(this.queues)) {
            let queue = this.queues[key];
            clearInterval(queue.interval);
            await queue.redis.disconnect();
            queue.redis.isClosing = true;
        }
        await this.queueClient.disconnect();
    }
}

let monitorQueue = function(queueName, redisClient, blockingRedisClient, emit, log){
    let queueLoop = async function () {
        let eventId;
        try {
            eventId = await blockingRedisClient.brpoplpush(queueName, `${queueName}:processing`, 0);
        } catch (err) {
        }

        if (blockingRedisClient.isClosing) {
            return;
        }

        if (!eventId) {
            queueLoop();
            return;
        }

        let event = JSON.parse(await redisClient.get(`${queueName}:${eventId}`));

        if (!event) {
            log(`ERROR: Unable to load event: ${queueName}:${eventId}. Found in List/Queue, but entity not stored. Removing from List`);
            await redisClient.lrem(`${queueName}:processing`, 1, eventId);
            queueLoop();
            return;
        }

        emit(queueName, event);

        await redisClient.lrem(`${queueName}:processing`, 1, eventId);
        await redisClient.del(`${queueName}:${eventId}`);

        queueLoop();
    }.bind(this);
    queueLoop();

    let requeueLoop = async function () {
        let processing = await redisClient.lrange(`${queueName}:processing`, 0, -1);

        for (let eventId of processing) {
            let lock = await redisClient.get(`${queueName}:lock:processing:${eventId}`);

            if (lock === null) {
                await redisClient.setex(`${queueName}:lock:processing:${eventId}`, 60, null);
                await redisClient.lrem(`${queueName}:processing`, 1, eventId);
                await redisClient.rpush(queueName, eventId);
            }
        }
    }.bind(this);
    let interval = setInterval(requeueLoop, this.requeueDelay);

    return {redis: blockingRedisClient, interval: interval, count : 1};
};

module.exports = RedisQueue;