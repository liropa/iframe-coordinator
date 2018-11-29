import WorkerClient from "iframe-coordinator/WorkerClient";

const client = new WorkerClient(() => {
  // Shutdown requested from host.  Clean-up; WorkerClient will ack
  if (currTimeout) {
    clearTimeout(currTimeout);
    currTimeout = null;
  }

  // Not strictly necessary, but a good practice
  client.unsubscribe('host.topic');
});

// Routing example
// client.requestNavigation('/wikipedia');

// Pub-Sub Example
client.subscribe('host.topic');
client.onPubsub(publication => {
  console.log(`Worker received pub-sub data on topic ${publication.topic}:`, publication.payload);

  client.publish({
    topic: 'workers.topic',
    payload: 'Hello, Host!'
  });
});

// Toasting Example
let currTimeout = setTimeout(sendToastMessage, getTimeout(5000, 10000));

function sendToastMessage() {
  client.requestToast({
    title: 'Hello worker World',
    message: 'from a Headless Worker',
    custom: {
      level: 'info'
    }
  });

  currTimeout = setTimeout(sendToastMessage, getTimeout());
}

function getTimeout(min=30000, max=60000) {
  return Math.max(min, Math.round(Math.random() * max));
}