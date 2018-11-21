// This worker is designed to showcase worker error rate handling.
import WorkerClient from "iframe-coordinator/WorkerClient";

const client = new WorkerClient(() => {
  // Shutdown requested from host.  Clean-up; WorkerClient will ack
  if (currTimeout) {
    clearTimeout(currTimeout);
    currTimeout = null;
  }
});

let currTimeout = setTimeout(triggerError, getTimeout());

function triggerError() {
  // Setup the next error call, since the error will stop this function execution
  currTimeout = setTimeout(triggerError, getTimeout());

  console.error('Triggering an intentional error from a worker.  Will not pop rate limit');
  foo.bar.baz();
}

function getTimeout(min=10000, max=30000) {
  return Math.max(min, Math.round(Math.random() * max));
}