let assert = require('assert-plus');
let sinon = require('sinon');

let redis = require('ioredis');

let expect = require('chai').expect;

let clock;
let pubMock;
let subMock;

let aEvents = require('../index');

let guidRegex= '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}';

beforeEach(()=>{
    clock = sinon.useFakeTimers({
        now: 1571328769626
    });

    pubMock = sinon.mock(redis.prototype);
    subMock = sinon.mock(redis.prototype);

});

afterEach(()=>{
    sinon.restore();

    pubMock.verify();
    subMock.verify();
});

const call = (fn, ...args) => ({ fn, args });

describe('RedisEvents', function(){
    describe('constructor', function(){
        it('should require options', function(done){
            //redisMock.expects().once();

            expect(()=> new aEvents.RedisEvents()).to.throw(assert.AssertionError);


            done();
        });
        it('should require options.redis', function(done){
            expect(()=> new aEvents.RedisEvents({})).to.throw(assert.AssertionError);

            done();
        });
        it('should require options.redis', function(done){

            let t = new aEvents.RedisEvents({redis:{pubClient: pubMock.object, subClient:subMock.object}});

            done();
        });
    });
    describe('emit', function(){
        it('should call redis publish with id and timestamp', function(done){
            let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient:subMock.object}});

            pubMock
                .expects('publish')
                .once()
                .withExactArgs('test', sinon.match(new RegExp('{"test":"args","eventId":"'+ guidRegex +'","emittedAt":1571328769626}')));
            
            events.emit('test', {test:"args"});

            done();
        });
    });
    describe('on', function(){
        it('should call supplied function during redis message', function(done){
            (async function() {
                let eventFunction;

                subMock.expects('on', sinon.match.func).once().callsFake((...args) => {
                    assert(args[0], 'message');
                    assert.func(args[1]);
                    eventFunction = args[1];
                });

                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                subMock.expects('subscribe').once().withExactArgs('test');

                //await is important as .on requires us to subscribe to redis which requires a network call.
                //If not used, this test would fail as it would attempt to send the message before the listener is actually bound
                await events.on('test', function (args) {
                    expect(args).to.eql({test:'args'});
                    done();
                });

                eventFunction('test', JSON.stringify({test: 'args'}));
            })();
        });
        it('should handle multiple subscriptions', function(done){
            (async function() {
                let eventFunction;

                subMock.expects('on', sinon.match.func).once().callsFake((...args) => {
                    assert(args[0], 'message');
                    assert.func(args[1]);
                    eventFunction = args[1];
                });

                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                subMock.expects('subscribe').exactly(5);


                let test1Count = 0;
                await events.on('test1', function (args) {
                    expect(args).to.eql({test:'args1'});
                    test1Count++;
                });

                let test2Count = 0;
                await events.on('test2', function (args) {
                    expect(args).to.eql({test:'args2'});
                    test2Count++;
                });

                let test3Count = 0;
                await events.on('test3', function (args) {
                    expect(args).to.eql({test:'args3'});
                    test3Count++;
                });

                let test4Count = 0;
                await events.on('test4', function (args) {
                    expect(args).to.eql({test:'args4'});
                    test4Count++
                });

                let test5Count = 0;
                await events.on('test5', function (args) {
                    expect(args).to.eql({test:'args5'});
                    test5Count++
                });

                eventFunction('test1', JSON.stringify({test: 'args1'}));
                eventFunction('test2', JSON.stringify({test: 'args2'}));
                eventFunction('test3', JSON.stringify({test: 'args3'}));
                eventFunction('test4', JSON.stringify({test: 'args4'}));

                eventFunction('test4', JSON.stringify({test: 'args4'}));
                eventFunction('test3', JSON.stringify({test: 'args3'}));
                eventFunction('test2', JSON.stringify({test: 'args2'}));

                expect(test1Count).to.equal(1);
                expect(test2Count).to.equal(2);
                expect(test3Count).to.equal(2);
                expect(test4Count).to.equal(2);
                expect(test5Count).to.equal(0);

                done();
            })();
        });
    });
    describe('removeListener', function() {
        it('should do nothing if not listening', function (done) {
            (async function () {
                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                await events.removeListener('test', ()=>{});

                done();

            })();
        });
        it('should do nothing if multiple listeners are listening', function (done) {
            (async function () {
                let eventFunction;
                subMock.expects('on', sinon.match.func).once().callsFake((...args) => {
                    assert(args[0], 'message');
                    assert.func(args[1]);
                    eventFunction = args[1];
                });
                subMock.expects('subscribe').once().withExactArgs('test');


                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                let func1 = () =>{
                    return console.log('func1');
                };
                let func2 = () =>{
                    return console.log('func2');
                };

                await events.on('test', func1);
                await events.on('test', func2);

                await events.removeListener('test', func1);

                done();

            })();
        });
        it('should unsubscribe if all listeners are removed', function (done) {
            (async function () {
                let eventFunction;
                subMock.expects('on', sinon.match.func).once().callsFake((...args) => {
                    assert(args[0], 'message');
                    assert.func(args[1]);
                    eventFunction = args[1];
                });
                subMock.expects('subscribe').once().withExactArgs('test');
                subMock.expects('unsubscribe').once().withExactArgs('test');

                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                let func1 = () =>{
                    return console.log('func1');
                };
                let func2 = () =>{
                    return console.log('func2');
                };

                await events.on('test', func1);
                await events.on('test', func2);

                await events.removeListener('test', func1);
                await events.removeListener('test', func2);

                done();

            })();
        });
        it('should re-subscribe if all listeners are removed and added again', function (done) {
            (async function () {
                let eventFunction;
                subMock.expects('on', sinon.match.func).once().callsFake((...args) => {
                    assert(args[0], 'message');
                    assert.func(args[1]);
                    eventFunction = args[1];
                });
                subMock.expects('subscribe').once().withExactArgs('test');
                subMock.expects('unsubscribe').once().withExactArgs('test');
                subMock.expects('subscribe').once().withExactArgs('test');

                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                let func1 = () =>{
                    return console.log('func1');
                };
                let func2 = () =>{
                    return console.log('func2');
                };

                await events.on('test', func1);
                await events.on('test', func2);

                await events.removeListener('test', func1);
                await events.removeListener('test', func2);

                await events.on('test', func1);
                await events.on('test', func2);

                done();

            })();
        });
        it('should handle unsubscribing incorrectly by providing the same function twice', function (done) {
            (async function () {
                let eventFunction;
                subMock.expects('on', sinon.match.func).once().callsFake((...args) => {
                    assert(args[0], 'message');
                    assert.func(args[1]);
                    eventFunction = args[1];
                });
                subMock.expects('subscribe').once().withExactArgs('test');
                //subMock.expects('unsubscribe').once().withExactArgs('test');

                let events = new aEvents.RedisEvents({redis: {pubClient: pubMock.object, subClient: subMock.object}});

                let func1 = () =>{
                    return console.log('func1');
                };
                let func2 = () =>{
                    return console.log('func2');
                };

                await events.on('test', func1);
                await events.on('test', func2);

                await events.removeListener('test', func1);
                await events.removeListener('test', func1);

                done();

            })();
        });
    });
});

