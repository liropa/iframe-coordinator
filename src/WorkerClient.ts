import { ToastingClient } from './basic-types';
import {
  HostToWorkers,
  validate as validateHostToWorkers
} from './messages/HostToWorkers';
import { Publication } from './messages/Publication';
import { Toast } from './messages/Toast';
import {
  validateWorkerMgrToWorker,
  WorkerLifecycleMsgTypes,
  WorkerMgrToWorker,
  WorkerToWorkerMgr
} from './messages/WorkerLifecycle';
import { WorkerToHost } from './messages/WorkerToHost';
import { PublicationHandler, SubscriptionManager } from './SubscriptionManager';
import { WORKER_MESSAGING_PROTOCOL_NAME } from './workers/constants';

const ctx: Worker = self as any;

/**
 * Callback function to be called upon receiving before_terminate event.  This function
 * should preform any cleanup required by the worker.  Return falsy to indicate cleanup is complete,
 * truthy to indicate manual terminateReady will be provided by the client, or a thenable to trigger
 * terminateReady once the promise resolves/rejects.
 */
type BeforeTerminateCallback = () => any;

/**
 * WorkerClient is an API for headless workers to communicate with other actors
 * in an iframe-coordinator managed app.
 *
 * An instance should be constructed and used by web-workers and can be used to
 * do things such as request toasts from the host app, request navigation, handle inbound
 * messages, etc.
 *
 * Users of this API are encouraged to use other web technologies (fetch, web-sockets, etc.)
 * along with this API to build compelling, headless features in their apps.
 */
export default class WorkerClient
  implements ToastingClient, EventListenerObject {
  private _subscriptionManager: SubscriptionManager;
  private _onBeforeTerminateCallback: null | BeforeTerminateCallback;

  /**
   * @param onBeforeTerminate Optional function to be called to allow the worker to cleanup before termination
   * If null, no cleanup will be run and the worker will immediately be eligible for termination.
   * If a function is provided and falsy is returned, the worker will be eligible for termination
   * when the function returns.
   * If a function is provided and a Promise is returned, the worker will be eligible for termination
   * when the promise resolves/rejects.
   * If a function is provided and any other truthy value is returned, you will be requeired to indicate
   * when the worker is ready for termination by calling #terminateReady().  Note, however, that cleanup
   * is still subject to the wait timeout configured for this worker.
   *
   * See #onBeforeTerminate
   */
  constructor(
    onBeforeTerminateCallback: null | BeforeTerminateCallback = null
  ) {
    this._subscriptionManager = new SubscriptionManager();
    this.onBeforeTerminate = onBeforeTerminateCallback;

    ctx.addEventListener('message', this);
  }

  /**
   * Set an optional function to be called to allow the worker to cleanup before termination
   *
   * If null, no cleanup will be run and the worker will immediately be eligible for termination.
   * If a function is provided and falsy is returned, the worker will be eligible for termination
   * when the function returns.
   * If a function is provided and a Promise is returned, the worker will be eligible for termination
   * when the promise resolves/rejects.
   * If a function is provided and any other truthy value is returned, you will be required to indicate
   * when the worker is ready for termination by calling #terminateReady().  Note, however, that cleanup
   * is still subject to the wait timeout configured for this worker.
   */
  public set onBeforeTerminate(callback: null | BeforeTerminateCallback) {
    if (callback !== null && typeof callback !== 'function') {
      throw new Error(
        'onBeforeTerminate must be assigned to null or a function'
      );
    }

    this._onBeforeTerminateCallback = callback;
  }

  public requestToast(toast: Toast): void {
    this._sendMessage({
      msgType: 'toastRequest',
      msg: toast
    });
  }

  /**
   * Request that the primary frame be navigated to the specified route
   *
   * @param destination The desired route or URL of the primary frame.
   */
  public requestNavigation(destination: string): void {
    this._sendMessage({
      msgType: 'navRequest',
      msg: {
        url: destination
      }
    });
  }

  /**
   * Subscribes to a topic published by the host.
   *
   * @param topic - The topic name the worker is interested in.
   */
  public subscribe(topic: string): void {
    this._subscriptionManager.subscribe(topic);
  }

  /**
   * Unsubscribes to a topic published by the host.
   *
   * @param topic - The topic name the worker is no longer interested in.
   */
  public unsubscribe(topic: string): void {
    this._subscriptionManager.unsubscribe(topic);
  }

  /**
   * Publish a message to the host
   *
   * @param publication - The information published to the host.
   * The topic may not be of interest, and could be ignored.
   */
  public publish(publication: Publication): void {
    this._sendMessage({
      msgType: 'publish',
      msg: publication
    });
  }

  /**
   * Sets the callback for general publication messages coming from the host application.
   *
   * Only one callback may be set.
   *
   * @param callback The handler to be called when a message is published.
   */
  public onPubsub(callback: PublicationHandler): void {
    this._subscriptionManager.setHandler(callback);
  }

  /**
   * Call this method to notify the WorkerManager that all cleanup of
   * this worker has been completed and it can now be terminated.
   */
  public terminateReady(): void {
    this._sendMessage({
      msgType: WorkerLifecycleMsgTypes.WorkerTerminateReady,
      msg: null
    });
  }

  /**
   * Event handler for this object
   * @param evt The Event to handle
   */
  public handleEvent(evt: Event): void {
    if (!(evt instanceof MessageEvent)) {
      return;
    }

    const msgEvent = evt as MessageEvent;

    if (msgEvent.data.protocol !== WORKER_MESSAGING_PROTOCOL_NAME) {
      // Not a handled message type
      return;
    }

    const mgrToWorker = validateWorkerMgrToWorker(msgEvent.data);
    if (mgrToWorker !== null) {
      this._onMgrToWorkerMsg(mgrToWorker);
      return;
    }

    const hostToWorkers = validateHostToWorkers(msgEvent.data);
    if (hostToWorkers !== null) {
      this._onHostToWorkersMsg(hostToWorkers);
      return;
    }

    /*
     * No need to log here; manager sends other messages to the spawn worker
     * so reaching this point is an expected runtime condition.
     */
    return;
  }

  /*
   * Handle applicable, incoming messages from the workerManager to this worker
   *
   * @returns boolean indicating successful processing to ensure all cases of
   * the descriminated union are handled
   */
  private _onMgrToWorkerMsg(mgrToWorker: WorkerMgrToWorker): boolean {
    switch (mgrToWorker.msgType) {
      case WorkerLifecycleMsgTypes.BeforeTerminate:
        // Clean up the subscription manager to ensure quick GC
        this._subscriptionManager.removeHandler();

        // Unconditionally clean up this instance as a message listener
        ctx.removeEventListener('message', this);

        let terminateReady = true;

        if (this._onBeforeTerminateCallback) {
          // Call the registed clean-up callback and auto-ack clean-up
          let result: any;
          try {
            result = this._onBeforeTerminateCallback();
          } catch (e) {
            // Set to false to immediately terminate
            result = false;
          }

          if (!!result) {
            // Manual terminate or promise cases
            terminateReady = false;
            ['then', 'catch'].forEach(curr => {
              if (result[curr] && typeof result[curr] === 'function') {
                result[curr](() => {
                  this.terminateReady();
                });
              }
            });
          }
        }

        if (terminateReady) {
          this.terminateReady();
        }

        return true;
    }
  }

  /*
   * Handle applicable, incoming messages from the host to this worker
   *
   * @returns boolean indicating successful processing to ensure all cases of
   * the descriminated union are handled
   */
  private _onHostToWorkersMsg(hostToWorkers: HostToWorkers): boolean {
    switch (hostToWorkers.msgType) {
      case 'publish':
        this._subscriptionManager.dispatchMessage(hostToWorkers.msg);
        return true;
    }
  }

  private _sendMessage(msg: WorkerToHost | WorkerToWorkerMgr): void {
    ctx.postMessage(
      Object.assign(
        {
          protocol: WORKER_MESSAGING_PROTOCOL_NAME
        },
        msg
      )
    );
  }
}
