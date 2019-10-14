require('wtfnode').init();
let E = require('./events.js');


(async function(){
    let events = new E({queueKeyPredicate: 'queue2', redis:{port: 6379, host:"127.0.0.1"}});
    //let events = new E();

    let print = function(args){
        console.log(args);
    };
    let print2 = function(args){
        console.log(args);
        console.log('2');
    };
    let print3 = function(args){
        console.log(args);
        console.log('3');
    };

    // await events.on('test', print);
    // await events.on('test2', print);
    // await events.on('test3', print);
    //
    // await events.once('test5', print);
    //
    // await events.onDequeue('queue', print);
    // await events.onDequeue('queue2', print2);
    //
    // events.emit('test', {arg1:true});
    // events.emit('test5', {arg1:true});
    // events.emit('test5', {arg1:true});

    // let t = require('events');
    // let test = new t();
    //
    // test.on('test', print);
    // test.once('test2', print2);
    //
    // test.emit('test2', {arg2:true});

    //events.on('test', print);

    await events.on('test', print);
    await events.on('test2', print2);
    await events.once('test3', print3);

    events.emit('test', {arg2:true});
    events.emit('test2', {arg2:true});

    await events.emit('test3', {arg2:true});
    await events.emit('test3', {arg2:true});
    await events.emit('test3', {arg2:true});
    await events.emit('test3', {arg2:true});

    // events.emit('test', {arg2:true});
    //
    // events.emit('test', {arg2:true});
    // events.emit('test2', {arg2:true});

    //await events.on('test', print);
    //await events.once('test2', print2);

    //events.emit('test', {arg1:true});
    //events.emit('test2', {arg2:true});

    //events.enqueue('queue', {que:true});
    //events.enqueue('queue2', {que2:true});
    //events.enqueue('queue3', {que:true});

    //events.emit('test2', {arg2:true});

    //test.emit('test2', {arg2:true});
    setTimeout((async function(){
        events.close();
    }), 2000);

})();

