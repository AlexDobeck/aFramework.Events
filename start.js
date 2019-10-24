// sugar for console.log we'll use later
const log = msg => console.log(msg);
const call = (fn, ...args) => ({ fn, args });
const put = (msg) => ({ msg });
// imported from I/O API
const sendMessage = msg => Promise.resolve('some response');
// imported from state handler/Reducer
const handleResponse = response => ({
    type: 'RECEIVED_RESPONSE',
    payload: response
});

const handleError = err => ({
    type: 'IO_ERROR',
    payload: err
});

function* sendMessageSaga (msg) {
    try {
        const response = yield call(sendMessage, msg);
        yield put(handleResponse(response));
    } catch (err) {
        yield put(handleError(err));
    }
}

const iter = sendMessageSaga('Hello, world!');
// Returns an object representing the status and value:
const step1 = iter.next();
//const next = iter.next("payload");
//const again = iter.next();
log(step1);
//log(again);
//iter.throw(new Error());
/* =>
{
  done: false,
  value: {
    fn: sendMessage
    args: ["Hello, world!"]
  }
}
*/

const { value: {fn, args }} = step1;
const step2 = fn(args);
step2.then(log); // "some response"

const again = iter.next(step2);
log(again);