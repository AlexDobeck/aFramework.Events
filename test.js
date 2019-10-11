require('wtfnode').init();
let E = require('./events.js');


(async function(){
    let events = new E({queueKeyPredicate: 'queue2', redis:{port: 6379, host:"127.0.0.1"}});
    //let events = new E();

    let print = function(event, args){
        console.log(event);
        console.log(args);
    };
    let print2 = function(event, args){
        console.log(event);
        console.log(args);
        console.log('2');
    };
    let print3 = function(event, args){
        console.log(event);
        console.log(args);
        console.log('3');
    };

    await events.on('test', print);
    await events.on('test2', print);
    await events.on('test3', print);

    await events.onDequeue('queue', print);
    await events.onDequeue('queue2', print2);

    events.emit('test5', {arg1:true});

    events.enqueue('queue', {que:true});
    events.enqueue('queue2', {que2:true});
    events.enqueue('queue3', {que:true});

    setTimeout(async function(){
        await events.close();
    }, 2000)

})();

