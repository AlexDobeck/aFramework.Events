const EventEmitter = require('events');

const assert = require('assert-plus');
const uuid = require('uuid').v4;
let ioredis = require('ioredis');

const util = require('util');

class RedisEvents extends EventEmitter {
    constructor(options, redis){
        if (redis){
            ioredis = redis;
        }
        super();

        assert.object(options, 'options Required');
        assert.object(options.redis,'options.redis Required');

        this.log = options && options.log ? options.log : function(a){console.log(a);};

        if (options && options.redis) {
            if (options.redis.host && options.redis.port){
                this.pubClient = new ioredis(options.redis.port || "6379", options.redis.host || "127.0.0.1");
                this.subClient = new ioredis(options.redis.port || "6379", options.redis.host || "127.0.0.1");
            } else if (options.redis.pubClient && options.redis.subClient) {
                this.pubClient = options.redis.pubClient;
                this.subClient = options.redis.subClient;
            } else {
                assert.string(options.pubPort);
                assert.string(options.subPort);
                assert.string(options.pubHost);
                assert.string(options.subHost);

                this.pubClient = new ioredis(options.pubPort || "6379", options.pubHost || "127.0.0.1");
                this.subClient = new ioredis(options.subPort || "6379", options.subHost || "127.0.0.1");
            }

            this.subClient.on('message', async (channel, message) => {
                await super.emit(channel, JSON.parse(message));
            });

        }

    };

    async close(){
        this.isClosing = true;
        await this.pubClient.disconnect();
        await this.subClient.disconnect();
    }

    async on(eventName, listener){
        if (super.listeners(eventName).length === 0){
            await this.subClient.subscribe(eventName);
        }

        return super.on(eventName, listener);
    }

    async removeListener(eventName, listener){
        let preLength = super.listeners(eventName).length;
        super.removeListener(eventName, listener);

        let t = super.listeners(eventName);

        if (preLength > 0 && super.listeners(eventName).length === 0){
            await this.subClient.unsubscribe(eventName);
        }

        return this;
    }

    async once(eventName, listener){
        if (typeof listener !== 'function') {
            throw new Error('Invalid listener function:' + listener);
        }

        return await this.on(eventName, _onceWrap(this, eventName, listener));
    }


    async emit(event, args){
        if (!args){
            args = {};
        }
        args.eventId = uuid();
        args.emittedAt = Date.now();
        await this.pubClient.publish(event, args);
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


module.exports = RedisEvents;