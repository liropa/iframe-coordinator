import { ToastingClient } from './basic-types';
import { Toast } from './messages/Toast';
import {
  validateWorkerMgrToWorker,
  WorkerLifecycleMsgTypes,
  WorkerToWorkerMgr
} from './messages/WorkerLifecycle';
import { WorkerToHost } from './messages/WorkerToHost';
import { WORKER_MESSAGING_PROTOCOL_NAME } from './workers/constants';

const ctx: Worker = self as any;

/**
 * Synchronous callback function to be called upon receiving before_terminate event.  This function
 * should preform any cleanup required by the worker.  Upon returning, this client will indicate
 * that the worker can now be terminated.
 */
type BeforeTerminateCallback = () => void;

/**
 * BackgroundClient is an API for headless workers to communicate with other actors
 * in an iframe-coordinator managed app.
 *
 * An instance should be constructed and used by web-workers and can be used to
 * do things such as request toasts from the host app, request navigation, etc.
 *
 * Users of this API are encouraged to use other web technologies (fetch, web-sockets, etc.)
 * along with this API to build compelling, headless features in their apps.
 */
export default class BackgroundClient
  implements ToastingClient, EventListenerObject {
  private _onBeforeTerminateCallback: null | BeforeTerminateCallback;

  /**
   * @param onBeforeTerminateCallback If non-null, this callback will be called upon
   * receiving a request to prepare for termination. When the function completes, a message
   * will be sent to the WorkerManager that the worker can now be terminated.  If you have
   * asynchronous cleanup to do, do not provide a callback and handle the beforeTerminate message
   * manually.  In addition, you should call #terminateReady() to indicate your cleanup is complete.
   */
  constructor(
    onBeforeTerminateCallback: null | BeforeTerminateCallback = null
  ) {
    this._onBeforeTerminateCallback = onBeforeTerminateCallback;

    ctx.addEventListener('message', this);
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
    this._handleEventExhaustively(evt);
  }

  /**
   * Private helper method with a return value to get compiler-level
   * assurance that all cases are handled
   *
   * @param evt Event to handle
   */
  private _handleEventExhaustively(evt: Event): boolean {
    if (!(evt instanceof MessageEvent)) {
      return false;
    }

    const msgEvent = evt as MessageEvent;

    if (msgEvent.data.protocol !== WORKER_MESSAGING_PROTOCOL_NAME) {
      // Not a handled message type
      return false;
    }

    const mgrToWorker = validateWorkerMgrToWorker(msgEvent.data);
    if (mgrToWorker === null) {
      // No need to log here; manager sends other messages to the spawn worker
      return false;
    }

    switch (mgrToWorker.msgType) {
      case WorkerLifecycleMsgTypes.BeforeTerminate:
        // Unconditionally clean up this instance as a message listener
        ctx.removeEventListener('message', this);

        if (this._onBeforeTerminateCallback) {
          this._onBeforeTerminateCallback();
          this.terminateReady();
        }

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
