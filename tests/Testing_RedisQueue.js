let assert = require('assert-plus');
let sinon = require('sinon').createSandbox();
let uuid = require('uuid');

let redis = require('ioredis');

let expect = require('chai').expect;

let clock;
let pubMock;
let subMock;

let aEvents = require('../index');

let guidRegex= '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}';

before(()=>{
});

beforeEach(()=>{
    clock = sinon.useFakeTimers({
        now: 1571328769626
    });

    pubMock = sinon.mock(redis.prototype);
    subMock = sinon.mock(redis.prototype);

});

afterEach(()=>{
    pubMock.verify();
    subMock.verify();

});

after(() => {
});

const call = (fn, ...args) => ({ fn, args });

describe('RedisQueues', function(){
    describe('constructor', function(){
        it('should require options', function(done){
            //redisMock.expects().once();

            expect(()=> new aEvents.RedisQueue()).to.throw(assert.AssertionError);


            done();
        });
        it('should require options.redis', function(done){
            expect(()=> new aEvents.RedisQueue({})).to.throw(assert.AssertionError);

            done();
        });
        it('should require options.redis', function(done){

            let t = new aEvents.RedisQueue({redis:{queueClient: pubMock.object}});

            done();
        });
    });
    describe('emit', function(){
        it('should call redis queuing functions', function(done){
            let events = new aEvents.RedisQueue({redis: {queueClient: pubMock.object}});

            pubMock.expects('setex').once().withExactArgs(sinon.match(new RegExp('test:lock:processing:'+ guidRegex)), 60, null);
            pubMock.expects('set').once().withExactArgs(sinon.match(new RegExp('test:' + guidRegex)), sinon.match(
                new RegExp(
                    '{"test":"args","eventId":"' + guidRegex + '","emittedAt":1571328769626}'
                )
            ));
            pubMock.expects('rpush').once().withExactArgs('test', sinon.match(new RegExp(guidRegex)));

            events.emit('test', {test:"args"});


            done();
        });
    });
    describe('on', function(){
        it('should call supplied function during redis message', function(done){
            (async function() {

                pubMock.expects('get', 'test:id').once().returns(JSON.stringify({test:true, channel:'test', eventId:'newId'}));
                pubMock.expects('lrem', 'test:processing', 1, 'newId').once();
                pubMock.expects('del', 'test:eventId');
                pubMock.expects('disconnect').once();

                let events = new aEvents.RedisQueue({redis: {queueClient: pubMock.object, blockingQueueClientFunction : () => {
                            return {
                                brpoplpush: () => {
                                    return 'id'
                                },
                                disconnect: () => {
                                }
                            };
                        }}});



                events.on('test', function (args) {
                    expect(args).to.eql({test:true, channel:'test', eventId:'newId'});
                    done();
                });

                events.close();
            })();
        });
        it('should handle multiple subscriptions', function(done){
            (async function() {

                pubMock.expects('get').withExactArgs(sinon.match(/test1:id/)).thrice().returns(JSON.stringify({
                    test1: true,
                    channel: 'test1'
                }));


                pubMock.expects('get').withExactArgs(sinon.match(/test2:id/)).thrice().returns(JSON.stringify({
                    test2: true,
                    channel: 'test1'
                }));

                pubMock.expects('get').withExactArgs(sinon.match(/test3:id/)).thrice().returns(JSON.stringify({
                    test3: true,
                    channel: 'test1'
                }));

                pubMock.expects('lrem', sinon.match(/'test[1-6]:processing'/), 1, sinon.match(/'id'/)).exactly(9);
                pubMock.expects('del', sinon.match(/'test[1-3]:id'/)).exactly(9);
                pubMock.expects('disconnect').once();

                let doneCount = 3;
                let complete = function(){
                    doneCount--;
                    if (doneCount === 0){
                        expect(test1Count).to.equal(3);
                        expect(test2Count).to.equal(3);
                        expect(test3Count).to.equal(3);
                        done();
                    }
                };
                let disconnecting = false;
                let events = new aEvents.RedisQueue({
                    redis: {
                        queueClient: pubMock.object, blockingQueueClientFunction: () => {
                            return new function() {
                                this.count = 0;
                                this.brpoplpush = async () => {
                                    let t = this;

                                    this.count++;
                                    if (this.count === 4){
                                        if (!disconnecting){
                                            disconnecting = true;
                                            await events.close();
                                            pubMock.verify();
                                        }
                                        complete();
                                        return;
                                    } else if (this.count > 4){
                                        return;
                                    }

                                    return 'id' + this.count;
                                };
                                this.disconnect= () => {
                                }
                            };
                        }
                    }
                });

                let test1Count = 0;
                events.on('test1', function (args) {
                    test1Count++;
                    expect(args.test1).to.be.true;
                });
                let test2Count = 0;
                events.on('test2', function (args) {
                    test2Count++;
                    expect(args.test2).to.be.true;
                });
                let test3Count = 0;
                events.on('test3', function (args) {
                    test3Count++;
                    expect(args.test3).to.be.true;
                });

            })();
        });
    });
});

