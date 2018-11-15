import { ToastingClient } from './basic-types';
import { Toast } from './messages/Toast';
import {
  WORKER_MESSAGING_PROTOCOL_NAME,
  WorkerLifecycleEvents,
  WorkerToHostMessageTypes
} from './workers/constants';

const ctx: Worker = self as any;

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
export default class BackgroundClient implements ToastingClient {
  public requestToast(toast: Toast): void {
    this._publishMessageToHost(WorkerToHostMessageTypes.toastRequest, toast);
  }

  // TODO Change this to URL based?
  /**
   * Request that the primary frame be navigated to the specified route
   *
   * @param route The desired route or URL of the primary frame.
   */
  public requestNavigation(route: string): void {
    this._publishMessageToHost(WorkerToHostMessageTypes.navRequest, {
      fragment: route
    });
  }

  /**
   * Call this method to notify the BackgroundClient manager that all cleanup of
   * this worker has been completed and it can now be terminated.
   */
  public unloadReady(): void {
    this._publishMessageToHost(WorkerLifecycleEvents.unload_ready);
  }

  private _publishMessageToHost(msgType: string, msg?: object): void {
    ctx.postMessage({
      protocol: WORKER_MESSAGING_PROTOCOL_NAME,
      msgType,
      msg
    });
  }
}
