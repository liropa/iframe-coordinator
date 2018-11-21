import BackgroundClient from "iframe-coordinator/BackgroundClient";
// TODO Need a better demo that makes more sense?

const client = new BackgroundClient(() => {
  // Shutdown requested from host.  Clean-up; BackgroundClient will ack
  if (currTimeout) {
    clearTimeout(currTimeout);
    currTimeout = null;
  }
});

// Routing example
// client.requestNavigation('/wikipedia');

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