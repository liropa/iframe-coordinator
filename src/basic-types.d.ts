import { Toast } from './messages/Toast';

interface LabeledMsg {
  msgType: string;
  msg: any;
}

type SubscribeHandler = (msg: LabeledMsg) => void;

// TODO remove this if we're not keeping the old interface
// export interface ToastOptions {
//   title?: null | string;
//   custom?: any;
// }

export interface ToastingClient {
  // TODO decide on this interface
  /**
   * Request a toast message be displayed by the host.
   *
   * The page embedding the host is responsible for handling the fired custom event and
   * presenting/styling the toast.  Application-specific concerns such as level, TTLs,
   * ids for action callbacks (toast click, toast action buttons), etc. can be passed via an object
   * as the custom property of the options param.
   *
   * @param {string} message - The message content of the toast
   * @param {object=} options - Supplimental toast options.
   * @param {string=} options.title - Optional title for the toast.
   * @param {object=} options.custom - Optional, application-specific toast properties.  Note: Properties must be JSON serializable.
   *
   * @example
   * worker.requestToast('Hello world');
   *
   * @example
   * worker.requestToast('World', {title: 'Hello'});
   *
   * @example
   * worker.requestToast('World', {title: 'Hello', custom: {ttl: 5, level: 'info'}});
   */
  // requestToast(message: string, options?: ToastOptions): void;

  /**
   * Request a toast message be displayed by the host.
   *
   * The page embedding the host is responsible for handling the fired custom event and
   * presenting/styling the toast.  Application-specific concerns such as level, TTLs,
   * ids for action callbacks (toast click, toast action buttons), etc. can be passed via an object
   * as the custom property of the options param.
   *
   * @param toast the desired toast configuration.
   *
   * @example
   * worker.requestToast({ title: 'Hello world' });
   *
   * @example
   * worker.requestToast({ title: 'Hello', message: 'World' });
   *
   * @example
   * worker.requestToast({ title: 'Hello', message: 'World', custom: { ttl: 5, level: 'info' } });
   */
  requestToast(toast: Toast): void;
}
